const { Events } = require("discord.js");
const { syncTables } = require("../utils/loadDb");
const { loadStats } = require("../utils/loadStats");
const { sweepActiveGroups, GROUP_SWEEP_INTERVAL_MS } = require("../utils/groupManager");

const updateInterval = 1_800_000;

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        await syncTables();
        console.log(`Ready! Logged in as ${client.user.tag}`);

        client.guilds.cache.forEach((guild) => {
            guild.roles
                .fetch()
                .then((roles) => {
                    // Create an object to store role names and IDs
                    const roleInfo = new Map();

                    // Iterate over each role and store the name and ID
                    roles.forEach((role) => {
                        roleInfo.set(role.name, role.id);
                    });

                    // Store the role information in the global map
                    global.roleMap.set(guild.id, roleInfo);
                })
                .catch((err) => {
                    console.error(`Error fetching roles for guild ${guild.name}: ${err}`);
                });
        });

        loadStats();

        setInterval(() => {
            loadStats();
        }, updateInterval);

        // Check persisted dungeon groups for formation timeouts and full-group
        // auto-finish; the first run also picks up groups posted before a restart
        const sweep = () =>
            sweepActiveGroups(client).catch((err) => console.error("Error sweeping dungeon groups:", err));

        sweep();
        setInterval(sweep, GROUP_SWEEP_INTERVAL_MS);
    },
};
