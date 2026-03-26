const { dungeonData, acronymToNameMap, FILLED_SPOT_TEXT } = require("./loadJson.js");

function stripListedAsNumbers(listedAs) {
    const pattern = /\+\s*((\d\s*){1,2}|\d{1,2})\b|M\s*0\b/;
    const result = listedAs.replace(pattern, "").trim();
    return result;
}

const cleanFilledValues = (role) => (role.includes(FILLED_SPOT_TEXT) ? role.slice(0, -1) : role);

const filterSpots = (spots, interactionUserId, reason) => {
    if (reason === "cancelled") {
        return spots.filter((member) => member !== interactionUserId && !member.includes(FILLED_SPOT_TEXT));
    } else {
        return spots.filter((member) => !member.includes(FILLED_SPOT_TEXT));
    }
};

async function sendCancelMessage(channel, mainObject, message) {
    const interactionUserId = mainObject.interactionUser.userId;
    const dungeonName = mainObject.embedData.dungeonName;
    const dungeonDifficulty = mainObject.embedData.dungeonDifficulty;

    let membersToTag = [];

    if (message === "cancelled by group creator") {
        membersToTag = [
            ...filterSpots(mainObject.roles.Tank.spots, interactionUserId, "cancelled"),
            ...filterSpots(mainObject.roles.Healer.spots, interactionUserId, "cancelled"),
            ...filterSpots(mainObject.roles.DPS.spots, interactionUserId, "cancelled"),
        ];
    } else {
        membersToTag = [
            ...filterSpots(mainObject.roles.Tank.spots, interactionUserId, "timed out"),
            ...filterSpots(mainObject.roles.Healer.spots, interactionUserId, "timed out"),
            ...filterSpots(mainObject.roles.DPS.spots, interactionUserId, "timed out"),
        ];
    }

    if (membersToTag.length === 0) return;

    await channel.send({
        content: `${dungeonName} ${dungeonDifficulty} ${message} \n${membersToTag.join(" ")}`,
    });
}

function generateRoleIcons(mainObject) {
    const roleIcons = [];
    const roleKeys = Object.keys(mainObject.roles).slice(0, 3);

    for (const role of roleKeys) {
        mainObject.roles[role].spots.forEach(() => {
            roleIcons.push(mainObject.roles[role].emoji);
        });
    }

    return roleIcons;
}

function generateRandomLetterPair() {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    let letters = "";
    for (let i = 0; i < 2; i++) {
        const randomIndex = Math.floor(Math.random() * alphabet.length);
        letters += alphabet[randomIndex];
    }
    return letters.toUpperCase();
}

function generateListedAsString(dungeon) {
    const dungeonAcronym = dungeonData[dungeon].acronym;
    const randomLetterPair = generateRandomLetterPair();
    return `NoP ${dungeonAcronym} ${randomLetterPair}`;
}

function generatePassphrase(wordList, wordCount = 3) {
    const shuffled = [...wordList];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, wordCount).join("");
}

const isDPSRole = (role) => role.includes("DPS");

function parseRolesToTag(difficulty, requiredComposition, guildId) {
    const uniqueRoles = [...new Set(requiredComposition)];

    let roleDifficultyString = "";

    if (difficulty == "M0") roleDifficultyString = "-M0";
    else if (difficulty < 4) roleDifficultyString = "-M2-3";
    else if (difficulty < 7) roleDifficultyString = "-M4-6";
    else if (difficulty < 10) roleDifficultyString = "-M7-9";
    else if (difficulty < 12) roleDifficultyString = "-M10-11";
    else if (difficulty < 14) roleDifficultyString = "-M12-13";
    else roleDifficultyString = "-M14+";

    const globalRoles = global.roleMap.get(guildId);
    const rolesToTag = [];

    for (const role of uniqueRoles) {
        const roleId = globalRoles.get(`${role}${roleDifficultyString}`);
        rolesToTag.push(`${roleId}`);
    }

    return rolesToTag.map((roleId) => `<@&${roleId}>`).join(" ");
}

async function sendPassphraseToUser(interaction, mainObject) {
    await interaction.followUp({
        content: `The passphrase for the dungeon is: \`${mainObject.utils.passphrase.phrase}\`\nAdd this to your note when applying to \`${mainObject.embedData.listedAs}\` in-game!`,
        ephemeral: true,
    });
}

function updateButtonState(mainObject, roleName) {
    const role = mainObject.roles[roleName];
    if (roleName === "Tank" || roleName === "Healer") {
        role.disabled = role.spots.length >= 1;
    } else {
        role.disabled = role.spots.length >= 3;
    }
}

// SAFE REMOVE
function removeUserFromRole(userId, userNickname, mainObject, roleName, roleData) {
    const spotIndex = roleData.spots.indexOf(userId);
    if (spotIndex !== -1) roleData.spots.splice(spotIndex, 1);

    const nickIndex = roleData.nicknames.indexOf(userNickname);
    if (nickIndex !== -1) roleData.nicknames.splice(nickIndex, 1);

    updateButtonState(mainObject, roleName);
}

function userExistsInAnyRole(userId, mainObject) {
    const firstThreeRoles = Object.entries(mainObject.roles).slice(0, 3);

    for (let [roleName, roleData] of firstThreeRoles) {
        if (roleData.spots.includes(userId)) {
            return [roleName, roleData];
        }
    }
    return false;
}

// FIXED FUNCTION
function addUserToRole(userId, userNickname, mainObject, newRole, typeOfCollector) {
    const role = mainObject.roles[newRole];

    // Special case
    if (userId === mainObject.interactionUser.userId && typeOfCollector === "groupUtilityCollector") {
        const filledSpot = mainObject.embedData.filledSpot;
        let filledSpotCounter = mainObject.embedData.filledSpotCounter;
        const filledSpotCombined = `${filledSpot}${filledSpotCounter}`;

        role.spots.push(filledSpotCombined);
        role.nicknames.push(filledSpot);

        filledSpotCounter++;
        mainObject.embedData.filledSpotCounter = filledSpotCounter;

        updateButtonState(mainObject, newRole);
        return "interactionUser";
    }

    // HARD LIMITS
    if (newRole === "DPS" && role.spots.length >= 3) return "roleFull";
    if ((newRole === "Tank" || newRole === "Healer") && role.spots.length >= 1) return "roleFull";

    // DUPLICATE CHECK
    if (role.spots.includes(userId)) return "alreadyInRole";

    if (!userExistsInAnyRole(userId, mainObject)) {
        role.spots.push(userId);
        role.nicknames.push(userNickname);
        updateButtonState(mainObject, newRole);
        return "newUser";
    } else {
        const [roleName, roleData] = userExistsInAnyRole(userId, mainObject);

        if (roleName === newRole) return "sameRole";

        removeUserFromRole(userId, userNickname, mainObject, roleName, roleData);

        role.spots.push(userId);
        role.nicknames.push(userNickname);
        updateButtonState(mainObject, newRole);

        return "existingUser";
    }
}

async function invalidDungeonString(interaction, reason) {
    let breakdownString = `\n\nExample string: \`${Object.keys(
        acronymToNameMap
    )[0].toLowerCase()} 0tbc d hdd\`\n\`aa\` - Short form dungeon name\n\`0tbc\` - dungeon level + run intention\n\`d\` - your role\n\`hdd\` - Required roles\n\nRun Intentions:\ntbc = Time But Complete\ntoa = Time or Abandon\nvc = Vault Completion\n`;

    for (const acronym in acronymToNameMap) {
        breakdownString += `\n ${acronym} - ${acronymToNameMap[acronym]}`;
    }

    if (!reason) reason = `Please enter a valid quick string.` + breakdownString;
    else reason += breakdownString;

    await interaction.reply({
        content: `${reason}`,
        ephemeral: true,
    });
}

module.exports = {
    stripListedAsNumbers,
    cleanFilledValues,
    generateRoleIcons,
    generateListedAsString,
    generatePassphrase,
    isDPSRole,
    parseRolesToTag,
    userExistsInAnyRole,
    addUserToRole,
    sendPassphraseToUser,
    removeUserFromRole,
    invalidDungeonString,
    sendCancelMessage,
};