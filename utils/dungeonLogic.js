const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonStyle,
} = require("discord.js");

const { createButton } = require("./discordFunctions");
const { generateRoleIcons } = require("./utilFunctions");

// Buttons on dungeon embeds carry the group ID in their customId
// (dungeon:<groupId>:<action>) so the global interactionCreate router can look
// the group up in the database, which keeps buttons working across restarts
function getDungeonCustomId(groupId, action) {
    return `dungeon:${groupId}:${action}`;
}

function getEligibleComposition(mainObject) {
    if (!mainObject.interactionUser.userChosenRole) {
        return new StringSelectMenuBuilder()
            .setCustomId("composition")
            .setPlaceholder("What roles are you looking for?")
            .setMinValues(1)
            .addOptions(new StringSelectMenuOptionBuilder().setLabel("Choose your role first!").setValue("none"));
    }

    const selectComposition = new StringSelectMenuBuilder()
        .setCustomId("composition")
        .setPlaceholder("What roles are you looking for?")
        .setMinValues(1)
        .setMaxValues(4);

    for (const role in mainObject.roles) {
        if (mainObject.roles[role].customId !== mainObject.interactionUser.userChosenRole) {
            const label = role.startsWith("DPS") ? "DPS" : role;

            selectComposition.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(label)
                    .setValue(mainObject.roles[role].customId)
                    .setEmoji(mainObject.roles[role].emoji)
            );
        }
    }

    return selectComposition;
}

function getDungeonObject(dungeon, difficulty, mainObject) {
    const listedAs = mainObject.embedData.listedAs;
    const timeCompletion = mainObject.embedData.timeOrCompletion;
    const creatorNotes = mainObject.embedData.creatorNotes;

    const tank = mainObject.roles.Tank;
    const healer = mainObject.roles.Healer;
    const dps = mainObject.roles.DPS;

    const tankEmoji = tank.emoji;
    const healerEmoji = healer.emoji;
    const dpsEmoji = dps.emoji;

    const tankNickname = tank.nicknames.join("\n");
    const healerNickname = healer.nicknames.join("\n");

    let dpsNicknames = dps.nicknames;

    const totalDps = 3;

    // Cap at max DPS slots and prevent negative array length
    dpsNicknames = dpsNicknames.slice(0, totalDps);
    const missing = Math.max(0, totalDps - dpsNicknames.length);

    const filledDpsEmojis = Array(totalDps).fill(dpsEmoji);
    const filledDpsNicknames = dpsNicknames.concat(Array(missing).fill(" "));

    const dpsList = filledDpsEmojis
        .map((emoji, index) => `${emoji} ${filledDpsNicknames[index]}`)
        .join("\n");

    const roleIcons = generateRoleIcons(mainObject);
    const joinedRoleIcons = roleIcons.join(" ");

    const roleFieldValue = `${tankEmoji} ${tankNickname}\n${healerEmoji} ${healerNickname}\n${dpsList}`;

    const fields = creatorNotes
        ? [
              {
                  name: `${dungeon} ${difficulty} (${timeCompletion})`,
                  value: `** \n"${creatorNotes}"\n\n${roleFieldValue}**`,
                  inline: false,
              },
          ]
        : [
              {
                  name: `${dungeon} ${difficulty} (${timeCompletion})`,
                  value: `**\n${roleFieldValue}**`,
                  inline: false,
              },
          ];

    const dungeonObject = {
        color: 0x3c424b,
        title: `${listedAs}  ${joinedRoleIcons}`,
        fields,
        footer: { text: "/lfghelp for more info about Dungeon Buddy" },
        status: "inProgress",
        spots: roleIcons.length,
    };

    if (roleIcons.length > 4) {
        dungeonObject.status = "full";
        dungeonObject.footer = null;
    }

    return dungeonObject;
}

function getDungeonButtonRow(mainObject, groupId) {
    const tank = mainObject.roles.Tank;
    const healer = mainObject.roles.Healer;
    const dps = mainObject.roles.DPS;

    return new ActionRowBuilder().addComponents(
        createButton({
            customId: getDungeonCustomId(groupId, tank.customId),
            emoji: tank.emoji,
            style: tank.style,
            disabled: tank.disabled,
        }),
        createButton({
            customId: getDungeonCustomId(groupId, healer.customId),
            emoji: healer.emoji,
            style: healer.style,
            disabled: healer.disabled,
        }),
        createButton({
            customId: getDungeonCustomId(groupId, dps.customId),
            emoji: dps.emoji,
            style: dps.style,
            disabled: dps.disabled,
        }),
        createButton({
            customId: getDungeonCustomId(groupId, "getPassphrase"),
            emoji: "🔑",
            style: ButtonStyle.Secondary,
            disabled: false,
        }),
        createButton({
            customId: getDungeonCustomId(groupId, "groupUtility"),
            label: "⚙️",
            style: ButtonStyle.Secondary,
            disabled: false,
        })
    );
}

function getTempFinishedButtonRow(groupId) {
    return new ActionRowBuilder().addComponents(
        createButton({
            customId: getDungeonCustomId(groupId, "groupUtility"),
            emoji: "⚙️",
            style: ButtonStyle.Secondary,
            disabled: false,
        })
    );
}

function getGroupChangeUtilityRow(idNickRoleMapping, mainObject) {
    const groupCreatorRole = mainObject.interactionUser.userChosenRole;

    const nicknames = Object.entries(idNickRoleMapping)
        .filter(([userId]) => userId !== mainObject.interactionUser.userId)
        .map(([userId, { nickname, role }]) => {
            return {
                label: nickname,
                value: userId,
                emoji: mainObject.roles[role].emoji,
            };
        });

    if (nicknames.length === 0) {
        nicknames.push({ label: "No users to remove", value: "none", emoji: "⛔" });
    }

    const removeUserRow = new StringSelectMenuBuilder()
        .setCustomId("removeGroupUsers")
        .setPlaceholder("Select users to remove from the group")
        .setMaxValues(nicknames.length)
        .addOptions(nicknames);

    const targetRoles = ["Tank", "Healer", "DPS"];
    const availableRoles = targetRoles
        .filter((roleName) => {
            const roleData = mainObject.roles[roleName];
            return (
                roleName !== groupCreatorRole &&
                ((roleName !== "DPS" && roleData.spots.length < 1) || (roleName === "DPS" && roleData.spots.length < 3))
            );
        })
        .map((roleName) => {
            const roleData = mainObject.roles[roleName];
            return {
                label: roleName,
                value: roleData.customId,
                emoji: roleData.emoji,
            };
        });

    if (availableRoles.length === 0) {
        availableRoles.push({ label: "No roles available", value: "none", emoji: "⛔" });
    }

    const changeRoleRow = new StringSelectMenuBuilder()
        .setCustomId("changeRole")
        .setPlaceholder("Change your role")
        .setMaxValues(1)
        .addOptions(availableRoles);

    const groupRemoveUserRow = new ActionRowBuilder().addComponents(removeUserRow);
    const groupChangeRoleRow = new ActionRowBuilder().addComponents(changeRoleRow);

    return [groupRemoveUserRow, groupChangeRoleRow];
}

function getGroupChangeConfirmRow() {
    const confirmGroupChangesButton = createButton({
        customId: "confirmGroupChanges",
        label: "Update Group",
        style: ButtonStyle.Primary,
        disabled: false,
    });

    const abortGroupChangesButton = createButton({
        customId: "abortGroupChanges",
        label: "Abort Changes",
        style: ButtonStyle.Secondary,
        disabled: false,
    });

    const cancelGroupButton = createButton({
        customId: "cancelGroup",
        label: "Cancel Group",
        style: ButtonStyle.Danger,
        disabled: false,
    });

    const finishGroupButton = createButton({
        customId: "finishGroup",
        label: "Finish Group",
        style: ButtonStyle.Success,
        disabled: false,
    });

    const groupChangeConfirmRow = new ActionRowBuilder().addComponents(
        confirmGroupChangesButton,
        abortGroupChangesButton,
        cancelGroupButton,
        finishGroupButton
    );

    return groupChangeConfirmRow;
}

function buildIdNickRoleMapping(mainObject) {
    const idNickRoleMapping = {};

    Object.entries(mainObject.roles).forEach(([role, { spots, nicknames }]) => {
        if (spots && nicknames) {
            spots.forEach((userId, index) => {
                const nickname = nicknames[index];
                if (userId && nickname) {
                    idNickRoleMapping[userId] = { nickname, role };
                }
            });
        }
    });

    return idNickRoleMapping;
}

module.exports = {
    getDungeonCustomId,
    getEligibleComposition,
    getDungeonObject,
    getDungeonButtonRow,
    getTempFinishedButtonRow,
    getGroupChangeUtilityRow,
    getGroupChangeConfirmRow,
    buildIdNickRoleMapping,
};
