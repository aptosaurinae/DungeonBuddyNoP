const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonStyle,
    ComponentType,
} = require("discord.js");

const { createButton } = require("./discordFunctions");
const { generateRoleIcons, sendPassphraseToUser, addUserToRole, removeUserFromRole } = require("./utilFunctions");

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

class DungeonManager {
    constructor() {
        this.tempFinishedCollector = null;
    }

    async processDungeonEmbed(i, rolesToTag, dungeon, difficulty, mainObject, groupUtilityCollector, callUser) {
        if (!i.deferred && !i.replied) {
            await i.deferUpdate();
        }

        const newDungeonObject = getDungeonObject(dungeon, difficulty, mainObject);

        const messageContent = `${mainObject.embedData.dungeonName} ${mainObject.embedData.dungeonDifficulty} - ${
            newDungeonObject.status === "full" ? `~~${rolesToTag}~~` : rolesToTag
        }`;

        const newEmbedButtonRow = getDungeonButtonRow(mainObject);

        try {
            if (newDungeonObject.status === "full") {
                const tempFinishedButtonRow = getTempFinishedButtonRow();

                const tempFinishedMessage = await i.editReply({
                    content: messageContent,
                    embeds: [newDungeonObject],
                    components: [tempFinishedButtonRow],
                });

                this.tempFinishedCollector = tempFinishedMessage.createMessageComponentCollector({
                    componentType: ComponentType.Button,
                    time: 600_000,
                });

                this.tempFinishedCollector.on("end", async (_, reason) => {
                    if (reason === "time" || reason === "finished") {
                        groupUtilityCollector.stop("finished");
                    } else if (reason === "groupInProgress") {
                        this.tempFinishedCollector = null;
                    }
                });
            } else {
                if (this.tempFinishedCollector) {
                    this.tempFinishedCollector.stop("groupInProgress");
                }

                await i.editReply({
                    content: messageContent,
                    embeds: [newDungeonObject],
                    components: [newEmbedButtonRow],
                });
            }
        } catch (e) {
            console.log("Error processing dungeon embed:", e);
        }

        if (callUser === "newUser") {
            await sendPassphraseToUser(i, mainObject);
        }
    }
}

// ✅ HIER ZAT JE CRASH → GEFIXT
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

    // ✅ FIX 1: Hard cap
    dpsNicknames = dpsNicknames.slice(0, totalDps);

    // ✅ FIX 2: No negative values
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

function getDungeonButtonRow(mainObject) {
    const tank = mainObject.roles.Tank;
    const healer = mainObject.roles.Healer;
    const dps = mainObject.roles.DPS;

    return new ActionRowBuilder().addComponents(
        createButton({ customId: tank.customId, emoji: tank.emoji, style: tank.style, disabled: tank.disabled }),
        createButton({ customId: healer.customId, emoji: healer.emoji, style: healer.style, disabled: healer.disabled }),
        createButton({ customId: dps.customId, emoji: dps.emoji, style: dps.style, disabled: dps.disabled }),
        createButton({ customId: "getPassphrase", emoji: "🔑", style: ButtonStyle.Secondary }),
        createButton({ customId: "groupUtility", label: "⚙️", style: ButtonStyle.Secondary })
    );
}

function getTempFinishedButtonRow() {
    return new ActionRowBuilder().addComponents(
        createButton({ customId: "groupUtility", emoji: "⚙️", style: ButtonStyle.Secondary })
    );
}

module.exports = {
    getEligibleComposition,
    getDungeonObject,
    getDungeonButtonRow,
    DungeonManager,
};