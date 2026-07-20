const { safeDeferUpdate } = require("./interactionSafety");
const {
    cleanFilledValues,
    addUserToRole,
    userExistsInAnyRole,
    removeUserFromRole,
    sendCancelMessage,
    sendPassphraseToUser,
} = require("./utilFunctions");
const { activeDungeonTable, dungeonInstanceTable, interactionStatusTable } = require("./loadDb");
const {
    getDungeonObject,
    getDungeonButtonRow,
    getTempFinishedButtonRow,
    getGroupChangeUtilityRow,
    getGroupChangeConfirmRow,
    buildIdNickRoleMapping,
} = require("./dungeonLogic");
const { processSendEmbedError } = require("./errorHandling");
const { currentExpansion, currentSeason } = require("./loadJson");

// Timeout constants
const GROUP_FORMATION_TIMEOUT_MS = 1_800_000; // 30 minutes to form a group before timing out
const TEMP_FINISHED_TIMEOUT_MS = 600_000; // 10 minutes before a full group is auto-finished
const GROUP_CHANGES_TIMEOUT_MS = 60_000; // 1 minute for the group change view
const GROUP_SWEEP_INTERVAL_MS = 60_000; // how often timed-out groups are checked for

const DUNGEON_CUSTOM_ID_PREFIX = "dungeon:";

// customIds used by embeds posted before the router migration; the collectors
// that owned them died with the process that created them
const LEGACY_CUSTOM_IDS = new Set(["Tank", "Healer", "DPS", "getPassphrase", "groupUtility"]);

// Groups are cached in memory for speed but every mutation is persisted to the
// database, so any group can be rebuilt from its row after a restart
const activeGroups = new Map();
const groupLocks = new Map();

function isDungeonCustomId(customId) {
    return customId.startsWith(DUNGEON_CUSTOM_ID_PREFIX);
}

function isLegacyDungeonCustomId(customId) {
    return LEGACY_CUSTOM_IDS.has(customId);
}

// Serialize all work per group so concurrent clicks can't interleave role
// changes or double-handle the same state (replaces the inProgress flags)
function withGroupLock(groupId, task) {
    const previous = groupLocks.get(groupId) || Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    groupLocks.set(groupId, run.catch(() => {}));
    return run;
}

async function createActiveGroup(mainObject, channel) {
    const expiresAt = Date.now() + GROUP_FORMATION_TIMEOUT_MS;

    const row = await activeDungeonTable.create({
        channel_id: channel.id,
        message_id: "",
        expires_at: new Date(expiresAt),
        state: "",
    });

    return {
        id: row.active_dungeon_id,
        channelId: channel.id,
        messageId: null,
        mainObject,
        expiresAt,
        fullSince: null,
        message: null,
    };
}

async function attachGroupMessage(group, message) {
    group.message = message;
    group.messageId = message.id;
    activeGroups.set(group.id, group);
    await persistGroup(group);
}

async function persistGroup(group) {
    await activeDungeonTable.update(
        {
            message_id: group.messageId,
            expires_at: new Date(group.expiresAt),
            state: JSON.stringify({ mainObject: group.mainObject, fullSince: group.fullSince }),
        },
        { where: { active_dungeon_id: group.id } }
    );
}

async function getGroup(groupId) {
    if (activeGroups.has(groupId)) {
        return activeGroups.get(groupId);
    }

    const row = await activeDungeonTable.findByPk(groupId);
    if (!row || !row.message_id || !row.state) {
        return null;
    }

    let savedState;
    try {
        savedState = JSON.parse(row.state);
    } catch (e) {
        console.error(`Could not parse saved state for dungeon group ${groupId}:`, e);
        return null;
    }

    const group = {
        id: groupId,
        channelId: row.channel_id,
        messageId: row.message_id,
        mainObject: savedState.mainObject,
        expiresAt: new Date(row.expires_at).getTime(),
        fullSince: savedState.fullSince || null,
        message: null, // refetched lazily via fetchGroupMessage
    };

    activeGroups.set(groupId, group);
    return group;
}

async function removeGroup(group) {
    activeGroups.delete(group.id);
    groupLocks.delete(group.id);
    await activeDungeonTable.destroy({ where: { active_dungeon_id: group.id } }).catch(console.error);
}

async function fetchGroupMessage(client, group) {
    if (group.message) {
        return group.message;
    }

    const channel = await client.channels.fetch(group.channelId);
    group.message = await channel.messages.fetch(group.messageId);
    return group.message;
}

async function saveDungeonToDb(mainObject, reason) {
    const tank = mainObject.roles.Tank.spots[0] ? cleanFilledValues(mainObject.roles.Tank.spots[0]) : "";
    const healer = mainObject.roles.Healer.spots[0] ? cleanFilledValues(mainObject.roles.Healer.spots[0]) : "";
    const dps = mainObject.roles.DPS.spots[0] ? cleanFilledValues(mainObject.roles.DPS.spots[0]) : "";
    const dps2 = mainObject.roles.DPS.spots[1] ? cleanFilledValues(mainObject.roles.DPS.spots[1]) : "";
    const dps3 = mainObject.roles.DPS.spots[2] ? cleanFilledValues(mainObject.roles.DPS.spots[2]) : "";

    await dungeonInstanceTable.create({
        dungeon_name: mainObject.embedData.dungeonName,
        dungeon_difficulty: mainObject.embedData.dungeonDifficulty,
        timed_completed: mainObject.embedData.timeOrCompletion,
        passphrase: mainObject.utils.passphrase.phrase,
        interaction_user: mainObject.interactionUser.userId,
        user_chosen_role: mainObject.interactionUser.userChosenRole,
        tank,
        healer,
        dps,
        dps2,
        dps3,
        expansion: currentExpansion,
        season: currentSeason,
        reason,
    });
}

// Re-render the dungeon embed from the group state and track full/not-full
// transitions (a group that stays full for TEMP_FINISHED_TIMEOUT_MS is
// auto-finished by the sweep)
async function updateDungeonMessage(client, group) {
    const mainObject = group.mainObject;
    const { dungeonName, dungeonDifficulty, rolesToTag } = mainObject.embedData;

    const dungeonObject = getDungeonObject(dungeonName, dungeonDifficulty, mainObject);
    const isFull = dungeonObject.status === "full";

    if (isFull) {
        if (!group.fullSince) {
            group.fullSince = Date.now();
        }
    } else {
        group.fullSince = null;
    }

    const messageContent = `${dungeonName} ${dungeonDifficulty} - ${isFull ? `~~${rolesToTag}~~` : rolesToTag}`;
    const components = [isFull ? getTempFinishedButtonRow(group.id) : getDungeonButtonRow(mainObject, group.id)];

    const message = await fetchGroupMessage(client, group);
    await message.edit({
        content: messageContent,
        embeds: [dungeonObject],
        components,
    });
}

async function finishGroup(client, group) {
    const mainObject = group.mainObject;

    try {
        await saveDungeonToDb(mainObject, "finished");

        // Remove the components from the embed when the group is finished
        const message = await fetchGroupMessage(client, group);
        await message.edit({
            components: [],
        });
    } catch (e) {
        console.log("Finished processing error:", e);
        await processSendEmbedError(e, "Finished processing error", mainObject.interactionUser.userId).catch(
            console.error
        );
    }

    await removeGroup(group);
}

async function cancelGroup(client, group) {
    const mainObject = group.mainObject;

    try {
        await saveDungeonToDb(mainObject, "cancelledAfterCreation");

        const message = await fetchGroupMessage(client, group);

        // Send a message to the group members that the group has been cancelled
        await sendCancelMessage(message.channel, mainObject, "cancelled by group creator");

        // Update the embed to show that the group has been cancelled
        await message.edit({
            content: `This group has been cancelled by the group creator.`,
            components: [],
        });
    } catch (e) {
        console.log("Cancelled after creation error:", e);
        await processSendEmbedError(e, "Cancelled after creation error", mainObject.interactionUser.userId).catch(
            console.error
        );
    }

    await removeGroup(group);
}

async function timeoutGroup(client, group) {
    const mainObject = group.mainObject;
    const { dungeonName, dungeonDifficulty } = mainObject.embedData;

    try {
        // Check whether the group was filled before it timed out
        const tempDungeonObject = getDungeonObject(dungeonName, dungeonDifficulty, mainObject);
        const message = await fetchGroupMessage(client, group);

        if (tempDungeonObject.status === "full") {
            await saveDungeonToDb(mainObject, "finished");

            await message.edit({
                components: [],
            });
        } else {
            await message.edit({
                content: `Group creation timed out! (~30 mins have passed).`,
                components: [],
            });

            // Update the interaction status to "timed out"
            await interactionStatusTable.update(
                { interaction_status: "timeoutAfterCreation" },
                { where: { interaction_id: mainObject.interactionId } }
            );

            // Send group timeout message to the group members
            await sendCancelMessage(message.channel, mainObject, "timed out");
        }
    } catch (e) {
        console.log("Group creation timeout error:", e);
        await processSendEmbedError(e, "Group creation timeout error", mainObject.interactionUser.userId).catch(
            console.error
        );
    }

    await removeGroup(group);
}

// Entry point for dungeon:<groupId>:<action> buttons, called from the global
// interactionCreate listener
async function handleDungeonButton(interaction) {
    // Acknowledge before any database or business logic so the 3 second
    // window can't expire while the click is being processed (error 10062)
    if (!(await safeDeferUpdate(interaction))) return;

    const [, groupIdRaw, action] = interaction.customId.split(":");
    const groupId = Number(groupIdRaw);
    if (!Number.isInteger(groupId)) return;

    await withGroupLock(groupId, async () => {
        const group = await getGroup(groupId);
        if (!group) {
            groupLocks.delete(groupId);
            await interaction
                .followUp({
                    content: "This group is no longer active. Please create a new group with /lfg.",
                    ephemeral: true,
                })
                .catch(() => {});
            return;
        }

        try {
            await routeGroupAction(interaction, group, action);
        } catch (e) {
            console.error(`Error handling dungeon button ${interaction.customId}:`, e);
            // The embed message or its channel no longer exists; retire the group
            if (e.code === 10008 || e.code === 10003) {
                await removeGroup(group);
            }
        }
    });
}

async function routeGroupAction(interaction, group, action) {
    const mainObject = group.mainObject;
    const interactionUserId = mainObject.interactionUser.userId;
    const discordUserId = `<@${interaction.user.id}>`;
    const discordNickname = interaction.member.nickname || interaction.user.globalName || interaction.user.username;

    if (action === "Tank" || action === "Healer" || action === "DPS") {
        const callUser = addUserToRole(discordUserId, discordNickname, mainObject, action, "groupUtilityCollector");
        if (action === "DPS" && callUser === "sameRole") {
            return;
        }

        await updateDungeonMessage(interaction.client, group);
        await persistGroup(group);

        if (callUser === "newUser") {
            await sendPassphraseToUser(interaction, mainObject);
        }
    } else if (action === "getPassphrase") {
        // Confirm the user is in the group
        if (!userExistsInAnyRole(discordUserId, mainObject)) {
            return;
        }

        let contentMessage;
        if (discordUserId === interactionUserId) {
            contentMessage = `The passphrase for the dungeon is: \`${mainObject.utils.passphrase.phrase}\`\nLook out for NoP members applying with this in-game!`;
        } else {
            contentMessage = `The passphrase for the dungeon is: \`${mainObject.utils.passphrase.phrase}\`\nAdd this to your note when applying to \`${mainObject.embedData.listedAs}\` in-game!`;
        }
        await interaction.followUp({
            content: contentMessage,
            ephemeral: true,
        });
    } else if (action === "groupUtility") {
        const existingRole = userExistsInAnyRole(discordUserId, mainObject);
        if (!existingRole) {
            return;
        }

        if (discordUserId === interactionUserId) {
            // The group creator has advanced options
            await openGroupChangeView(interaction, group);
        } else {
            const [roleName, roleData] = existingRole;
            removeUserFromRole(discordUserId, discordNickname, mainObject, roleName, roleData);

            await updateDungeonMessage(interaction.client, group);
            await persistGroup(group);
        }
    }
}

// The ephemeral group change view for the group creator. The view itself is
// short-lived (60s) so a collector is fine here; all state it mutates lives in
// the persistent group object and is saved through persistGroup
async function openGroupChangeView(interaction, group) {
    const mainObject = group.mainObject;

    try {
        // Map user IDs to their nicknames and roles
        let idNickRoleMapping = buildIdNickRoleMapping(mainObject);

        const [groupRemoveUserRow, groupChangeRoleRow] = getGroupChangeUtilityRow(idNickRoleMapping, mainObject);
        const groupChangeConfirmRow = getGroupChangeConfirmRow();

        const groupChangesView = await interaction.followUp({
            content: "Make changes to your group below.\n*To cancel your group click the 'Cancel Group' button 2x.*",
            ephemeral: true,
            components: [groupRemoveUserRow, groupChangeRoleRow, groupChangeConfirmRow],
        });

        // Add a collector to listen for the group changes
        const groupChangesCollector = groupChangesView.createMessageComponentCollector({
            time: GROUP_CHANGES_TIMEOUT_MS,
        });

        // Define variables to store the group changes
        let usersToRemove = null;
        let newGroupCreatorRole = null;
        let cancelGroupCounter = 0;

        groupChangesCollector.on("collect", async (i) => {
            try {
                // Acknowledge the interaction before any other work so the 3 second
                // window can't expire while the click is being processed (error 10062).
                // Acknowledged interactions use editReply/followUp instead of update/reply.
                if (!(await safeDeferUpdate(i))) return;

                await withGroupLock(group.id, async () => {
                    const dungeonName = mainObject.embedData.dungeonName;
                    const dungeonDifficulty = mainObject.embedData.dungeonDifficulty;
                    const dungeonObject = getDungeonObject(dungeonName, dungeonDifficulty, mainObject);
                    const groupStatus = dungeonObject.status;

                    // Reset cancel counter when any other button is clicked
                    if (i.customId !== "cancelGroup") {
                        cancelGroupCounter = 0;
                    }

                    if (i.customId === "removeGroupUsers") {
                        // Don't update the value if there's no users to remove
                        if (i.values[0] !== "none") {
                            usersToRemove = i.values;
                        }
                    } else if (i.customId === "changeRole") {
                        // Don't update the value if there's no roles to change to
                        if (i.values[0] !== "none") {
                            newGroupCreatorRole = i.values[0];
                        }
                    } else if (i.customId === "confirmGroupChanges") {
                        // Check if the user has made any changes
                        if (!usersToRemove && !newGroupCreatorRole) {
                            return;
                        }

                        // TODO: Change this so when the user wants to remove members they can choose to swap to that role
                        if (usersToRemove) {
                            // Update the idNickRoleMapping to make sure the member hasn't left already
                            idNickRoleMapping = buildIdNickRoleMapping(mainObject);

                            usersToRemove.forEach((userId) => {
                                try {
                                    if (!idNickRoleMapping[userId]) {
                                        return;
                                    }

                                    const { nickname, role } = idNickRoleMapping[userId];
                                    removeUserFromRole(userId, nickname, mainObject, role, mainObject.roles[role]);
                                } catch (e) {
                                    console.log("Error removing user from role:", e);
                                }
                            });
                            // Reset the users to remove to null after processing to avoid errors
                            usersToRemove = null;
                        }
                        if (newGroupCreatorRole) {
                            const role = mainObject.roles[newGroupCreatorRole];
                            let contentMessage = "";

                            // Check if the role is unavailable at the moment
                            if (role.inProgress) {
                                contentMessage = `The ${newGroupCreatorRole} role is unavailable at the moment. No changes have been made.`;
                            } else {
                                // Determine if the role is full based on its type and number of spots
                                const isDPSFull = newGroupCreatorRole === "DPS" && role.spots.length >= 3;
                                const isOtherRolesFull = newGroupCreatorRole !== "DPS" && role.spots.length >= 1;

                                if (isDPSFull || isOtherRolesFull) {
                                    contentMessage = `The ${newGroupCreatorRole} role is full. No changes have been made.`;
                                }
                            }

                            if (contentMessage) {
                                // Reset the new group creator role after failing to avoid errors
                                newGroupCreatorRole = null;

                                await i.editReply({
                                    content: contentMessage,
                                    components: [],
                                });
                                return;
                            }

                            // Temporarily set the new role to inProgress
                            role.inProgress = true;

                            const interactionUser = mainObject.interactionUser;
                            addUserToRole(
                                interactionUser.userId,
                                interactionUser.nickname + " 🚩",
                                mainObject,
                                newGroupCreatorRole,
                                "groupCancellationCollector"
                            );

                            // Reset the value to false after the user has been added
                            role.inProgress = false;

                            // Update the main object with the new group creator role
                            mainObject.interactionUser.userChosenRole = newGroupCreatorRole;

                            // Reset the new group creator role to null after processing
                            newGroupCreatorRole = null;
                        }

                        await updateDungeonMessage(i.client, group);
                        await persistGroup(group);

                        await i.editReply({
                            content: "Your changes have been made to the group.",
                            components: [],
                        });

                        groupChangesCollector.stop("confirmGroupChanges");
                    } else if (i.customId === "abortGroupChanges") {
                        await i.editReply({
                            content: "No changes have been made to the group.",
                            components: [],
                        });
                        groupChangesCollector.stop("abortGroupChanges");
                    } else if (i.customId === "cancelGroup") {
                        // Pressing the cancel button twice will cancel the group
                        if (cancelGroupCounter >= 1) {
                            await i.editReply({
                                content: "The group has been cancelled.",
                                components: [],
                            });
                            groupChangesCollector.stop("confirmCancelGroup");
                            return;
                        }
                        cancelGroupCounter++;
                        await i.followUp({
                            content: "Are you sure? Click 'Cancel Group' one more time to confirm.",
                            ephemeral: true,
                        });
                    } else if (i.customId === "finishGroup") {
                        if (groupStatus !== "full") {
                            await i.followUp({
                                content: "You cannot finish the group until it is full!",
                                ephemeral: true,
                            });
                        } else {
                            await i.editReply({
                                content: "The group is now formed. Enjoy your dungeon!",
                                components: [],
                            });
                            groupChangesCollector.stop("finishGroup");
                        }
                    }
                });
            } catch (e) {
                console.log("Error with group utility changes", e);
            }
        });

        groupChangesCollector.on("end", async (_, reason) => {
            try {
                if (reason === "time") {
                    await interaction
                        .followUp({
                            content:
                                "The group utility view has expired (60s). Please click on ⚙️ to open the group utility again.",
                            ephemeral: true,
                            components: [],
                        })
                        .catch((e) => console.log("Error sending group utility expiry message:", e));
                } else if (reason === "confirmCancelGroup") {
                    await withGroupLock(group.id, () => cancelGroup(interaction.client, group));
                } else if (reason === "finishGroup") {
                    await withGroupLock(group.id, () => finishGroup(interaction.client, group));
                }
            } catch (e) {
                console.log("Error finalising group changes:", e);
            }
        });
    } catch (e) {
        console.log("Error with group utility changes", e);
    }
}

// Buttons from embeds posted before the router migration: their collectors are
// gone, so strip the dead components and tell the user to make a new group
async function handleLegacyDungeonButton(interaction) {
    if (!(await safeDeferUpdate(interaction))) return;

    try {
        await interaction.editReply({ components: [] });
    } catch (e) {
        console.error("Error retiring legacy dungeon buttons:", e);
    }

    await interaction
        .followUp({
            content:
                "This group was posted before a bot restart and is no longer active. Please create a new group with /lfg.",
            ephemeral: true,
        })
        .catch(() => {});
}

// Periodic check (run from the ready event) for groups that hit their
// formation timeout or have been full long enough to auto-finish. Because
// groups are read back from the database, this also resumes groups that were
// posted before a restart.
async function sweepActiveGroups(client) {
    const rows = await activeDungeonTable.findAll();
    const now = Date.now();

    for (const row of rows) {
        const groupId = row.active_dungeon_id;

        // Rows without a message are left over from a crash between creating
        // the row and posting the embed; retire them once their window passes
        if (!row.message_id) {
            if (new Date(row.expires_at).getTime() <= now) {
                await row.destroy().catch(console.error);
            }
            continue;
        }

        await withGroupLock(groupId, async () => {
            const group = await getGroup(groupId);
            if (!group) {
                groupLocks.delete(groupId);
                await activeDungeonTable.destroy({ where: { active_dungeon_id: groupId } }).catch(console.error);
                return;
            }

            try {
                if (group.fullSince && now - group.fullSince >= TEMP_FINISHED_TIMEOUT_MS) {
                    await finishGroup(client, group);
                } else if (now >= group.expiresAt) {
                    await timeoutGroup(client, group);
                }
            } catch (e) {
                console.error(`Error sweeping dungeon group ${groupId}:`, e);
                // The embed message or its channel no longer exists; retire the group
                if (e.code === 10008 || e.code === 10003) {
                    await removeGroup(group);
                }
            }
        });
    }
}

module.exports = {
    GROUP_SWEEP_INTERVAL_MS,
    isDungeonCustomId,
    isLegacyDungeonCustomId,
    createActiveGroup,
    attachGroupMessage,
    handleDungeonButton,
    handleLegacyDungeonButton,
    sweepActiveGroups,
};
