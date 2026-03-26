const fs = require("fs");

function loadJSON(path) {
    return JSON.parse(fs.readFileSync(path, "utf8"));
}

function getConfig() {
    const config = loadJSON("./jsonFiles/config.json");
    return config;
}

function getDungeonData(currentExpansion, currentSeason) {
    const dungeonData = loadJSON(`./jsonFiles/dungeonData/${currentExpansion}/season${currentSeason}.json`);

    const dungeonList = [];
    const acronymToNameMap = {};

    for (const dungeon in dungeonData) {
        dungeonList.push(dungeon);
        acronymToNameMap[dungeonData[dungeon].acronym] = dungeon;
    }

    return { dungeonData, dungeonList, acronymToNameMap };
}

const config = getConfig();
const currentExpansion = config.currentExpansion;
const currentSeason = config.currentSeason;
const supportUserId = config.supportUserId;
const supportChannelId = config.supportChannelId;
const { dungeonData, dungeonList, acronymToNameMap } = getDungeonData(currentExpansion, currentSeason);
const wowWords = loadJSON("./jsonFiles/wowWords.json");

// Shared constant for filled spot placeholder text
const FILLED_SPOT_TEXT = "~~Filled NoP Spot~~";

module.exports = { dungeonData, dungeonList, acronymToNameMap, wowWords, currentExpansion, currentSeason, supportUserId, supportChannelId, FILLED_SPOT_TEXT };
