const { dungeonData, acronymToNameMap } = require("./loadJson.js");

// Remove level numbers or M0 from listedAs string
function stripListedAsNumbers(listedAs) {
    // Define regex pattern to match '+2' to '+50' or 'M0'
    const pattern = /\+\s*((\d\s*){1,2}|\d{1,2})\b|M\s*0\b/;
    return listedAs.replace(pattern, "").trim();
}

// Clean filled spots from role strings
const cleanFilledValues = (role) => (role.includes("~~Filled NoP Spot~~") ? role.slice(0, -1) : role);

// Filter spots for notifications or cancellations
const filterSpots = (spots, interactionUserId, reason) => {
    if (reason === "cancelled") {
        return spots.filter((member) => member !== interactionUserId && !member.includes("~~Filled NoP Spot"));
    } else {
        return spots.filter((member) => !member.includes("~~Filled NoP Spot"));
    }
};

// Send cancellation message to channel
async function sendCancelMessage(channel, mainObject, message) {
    const interactionUserId = mainObject.interactionUser.userId;
    const dungeonName = mainObject.embedData.dungeonName;
    const dungeonDifficulty = mainObject.embedData.dungeonDifficulty;

    let membersToTag = [];

    // Notify other members except the interaction user
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

// Generate role icons for embed
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

// Generate two random uppercase letters
function generateRandomLetterPair() {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    let letters = "";
    for (let i = 0; i < 2; i++) {
        letters += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return letters.toUpperCase();
}

// Generate listedAs string for dungeon
function generateListedAsString(dungeon) {
    const dungeonAcronym = dungeonData[dungeon].acronym;
    const randomLetterPair = generateRandomLetterPair();
    return `NoP ${dungeonAcronym} ${randomLetterPair}`;
}

// Generate passphrase from a list of words
function generatePassphrase(wordList, wordCount = 3) {
    for (let i = wordList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [wordList[i], wordList[j]] = [wordList[j], wordList[i]];
    }
    return wordList.slice(0, wordCount).join("");
}

// Check if role string contains DPS
const isDPSRole = (role) => role.includes("DPS");

// Parse roles to tag based on difficulty and required composition
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

// Send passphrase to user via ephemeral message
async function sendPassphraseToUser(interaction, mainObject) {
    await interaction.followUp({
        content: `The passphrase for the dungeon is: \`${mainObject.utils.passphrase.phrase}\`\nAdd this to your note when applying to \`${mainObject.embedData.listedAs}\` in-game!`,
        ephemeral: true,
    });
}

// Update button state if role is full
function updateButtonState(mainObject, roleName) {
    const role = mainObject.roles[roleName];
    const roleLimit = roleName === "Tank" || roleName === "Healer" ? 1 : 3;
    role.disabled = role.spots.length >= roleLimit;
}

// Remove user from role
function removeUserFromRole(userId, userNickname, mainObject, roleName, roleData) {
    roleData.spots.splice(roleData.spots.indexOf(userId), 1);
    roleData.nicknames.splice(roleData.nicknames.indexOf(userNickname), 1);
    updateButtonState(mainObject, roleName);
}

// Check if user exists in any role
function userExistsInAnyRole(userId, mainObject) {
    const firstThreeRoles = Object.entries(mainObject.roles).slice(0, 3);
    for (let [roleName, roleData] of firstThreeRoles) {
        if (roleData.spots.includes(userId)) return [roleName, roleData];
    }
    return false;
}

// Add or update a user in a role
function addUserToRole(userId, userNickname, mainObject, newRole, typeOfCollector) {
    const role = mainObject.roles[newRole];

    // Special case: interactionUser via groupUtilityCollector (filled spot)
    if (userId === mainObject.interactionUser.userId && typeOfCollector === "groupUtilityCollector") {
        const filledSpot = mainObject.embedData.filledSpot;
        let filledSpotCounter = mainObject.embedData.filledSpotCounter;
        const filledSpotCombined = `${filledSpot}${filledSpotCounter}`;

        role.spots.push(filledSpotCombined);
        role.nicknames.push(filledSpot);

        mainObject.embedData.filledSpotCounter = filledSpotCounter + 1;
        updateButtonState(mainObject, newRole);
        return "interactionUser";
    }

    const existingRoleData = userExistsInAnyRole(userId, mainObject);

    // User already exists in a role
    if (existingRoleData) {
        const [currentRoleName, currentRoleData] = existingRoleData;

        if (currentRoleName === newRole) {
            // User is updating their own listing (cogwheel)
            return "updatedOwnListing";
        }

        // Remove user from old role
        removeUserFromRole(userId, userNickname, mainObject, currentRoleName, currentRoleData);
    } else {
        // New user: check role limits
        const roleLimit = newRole === "Tank" || newRole === "Healer" ? 1 : 3;
        if (role.spots.length >= roleLimit) return "roleFull";
    }

    // Add user to the new role
    role.spots.push(userId);
    role.nicknames.push(userNickname);
    updateButtonState(mainObject, newRole);

    return existingRoleData ? "existingUser" : "newUser";
}

// Send invalid dungeon string message
async function invalidDungeonString(interaction, reason) {
    let breakdownString = `\n\nExample string: \`${Object.keys(acronymToNameMap)[0].toLowerCase()} 0tbc d hdd\`\n\`aa\` - Short form dungeon name\n\`0tbc\` - dungeon level + run intention\n\`d\` - your role\n\`hdd\` - Required roles\n\nRun Intentions:\ntbc = Time But Complete\ntoa = Time or Abandon\nvc = Vault Completion\n\nShort form Dungeon Names (not case-sensitive)`;
    for (const acronym in acronymToNameMap) {
        breakdownString += `\n ${acronym} - ${acronymToNameMap[acronym]}`;
    }

    const invalidDungeonString = `Please enter a valid quick string.`;
    reason = reason ? reason + breakdownString : invalidDungeonString + breakdownString;

    await interaction.reply({
        content: reason,
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