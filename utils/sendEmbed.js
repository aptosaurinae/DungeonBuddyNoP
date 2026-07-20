const { parseRolesToTag, generateListedAsString } = require("./utilFunctions");
const { getDungeonObject, getDungeonButtonRow } = require("./dungeonLogic");
const { createActiveGroup, attachGroupMessage } = require("./groupManager");
const { dungeonData } = require("./loadJson.js");

async function sendEmbed(mainObject, channel, requiredCompositionList) {
    const { dungeonName, dungeonDifficulty } = mainObject.embedData;

    // Get the roles to tag
    const rolesToTag = parseRolesToTag(dungeonDifficulty, requiredCompositionList, channel.guild.id);

    mainObject.embedData.rolesToTag = rolesToTag;

    // Generate a listed as string for the mainObject if the user hasn't specified one
    if (!mainObject.embedData.listedAs) {
        mainObject.embedData.listedAs = generateListedAsString(dungeonName);
    }

    // Create the object that is used to send to the embed
    const dungeonObject = getDungeonObject(dungeonName, dungeonDifficulty, mainObject);

    // Persist the group before posting so the buttons can carry its ID. Clicks
    // are handled by the global interactionCreate router (see groupManager),
    // which keeps working after a restart because state lives in the database.
    const group = await createActiveGroup(mainObject, channel);

    const embedButtonRow = getDungeonButtonRow(mainObject, group.id);

    const sentEmbed = await channel.send({
        content: `${dungeonData[dungeonName].acronym} ${dungeonDifficulty} - ${rolesToTag}`,
        embeds: [dungeonObject],
        components: [embedButtonRow],
    });

    await attachGroupMessage(group, sentEmbed);
}

module.exports = { sendEmbed };
