const momentTZ = require('moment-timezone');
const Fuse = require("fuse-js-latest");
require('moment-duration-format');
const mysql = require('mysql');
const {promisify, inspect} = require('util');      // eslint-disable-line no-unused-vars
const moment = require('moment');       // eslint-disable-line no-unused-vars
const { Op } = require('sequelize');    // eslint-disable-line no-unused-vars
const readdir = promisify(require("fs").readdir);       // eslint-disable-line no-unused-vars

module.exports = (client) => {
    // The scheduler for events
    client.schedule = require("node-schedule");
    /*
        PERMISSION LEVEL FUNCTION
        This is a very basic permission system for commands which uses "levels"
        "spaces" are intentionally left black so you can add them if you want.
        NEVER GIVE ANYONE BUT OWNER THE LEVEL 10! By default this can run any
        command including the VERY DANGEROUS `eval` and `exec` commands!
        */
    client.permlevel = message => {
        let permlvl = 0;

        // If bot owner, return max perm level
        if (message.author.id === client.config.ownerid) return 10;

        // If DMs or webhook, return 0 perm level.
        if (!message.guild || !message.member) return 0;
        const guildConf = message.guildSettings;

        // Guild Owner gets an extra level, wooh!
        if (message.channel.type === 'text') {
            if (message.author.id === message.guild.owner.id) return permlvl = 4;
        }

        // Also giving them the permissions if they have the manage server role, 
        // since they can change anything else in the server, so no reason not to
        if (message.member.hasPermission(['ADMINISTRATOR', 'MANAGE_GUILD'])) return permlvl = 3;

        // The rest of the perms rely on roles. If those roles are not found
        // in the settings, or the user does not have it, their level will be 0
        try {
            const adminRoles = guildConf.adminRole;

            for (var ix = 0, len = adminRoles.length; ix < len; ix++) {
                const adminRole = message.guild.roles.find(r => r.name.toLowerCase() === adminRoles[ix].toLowerCase());
                if (adminRole && message.member.roles.has(adminRole.id)) return permlvl = 3;
            }
        } catch (e) {() => {};}
        return permlvl;
    };

    client.myTime = () => {
        return momentTZ.tz('US/Pacific').format('M/D/YYYY hh:mma');
    };

    // This finds any character that matches the search, and returns them in an array
    client.findChar = (searchName, charList) => {
        const options = {
            tokenize: true,
            matchAllTokens: true,
            threshold: 0,
            distance: 0,
            keys: [ "name", "aliases" ]
        };
        const options2 = {
            keys: ['name', 'aliases'],
            threshold: .1,
            distance: 4
        };
        // In case of any extra spaces
        searchName = searchName.trim().toLowerCase();

        // Check the names for an exact match
        for (let ix = 0; ix < charList.length; ix++) {
            if (charList[ix].name.toLowerCase() === searchName) {
                return [charList[ix]];
            }
        }

        // If there's not an exact name match, fuzzy search it
        const fuse = new Fuse(charList, options);
        let chars = fuse.search(searchName);
        if (chars.length >= 1) {
            return chars;
        }

        // If it's not exact, send back the big mess
        const fuse2 = new Fuse(charList, options2);
        chars = fuse2.search(searchName);
        return chars;
    };



    // This find one character that matches the search, and returns it
    client.findCharByName = (searchName, charList) => {
        var options = {
            keys: ['name'],
            threshold: 0.0
        };
        const fuse = new Fuse(charList, options);
        const char = fuse.search(searchName);
        return char[0];
    };

    /*
     * LOGGING FUNCTION
     * Logs to console. Future patches may include time+colors
     */
    client.log = (type, msg, title="Log", codeType="md", prefix="") => {
        console.log(`[${client.myTime()}] [${type}] [${title}]${msg}`);
        try {
            const chan = client.config.logs.channel;
            const mess = `${prefix === '' ? '' : prefix + ' '}[${client.myTime()}] [${type}] ${msg}`.replace(/\n/g, '"|"');
            const args = {code: codeType, split: true};
            // Sends the logs to the channel I have set up for it.
            if (client.config.logs.logToChannel) {
                if (client.channels.has(chan)) {
                    client.sendMsg(chan, mess, args);
                } else if (client.shard && client.shard.count > 0) {
                    // If it's on a different shard, then send it there 
                    client.shard.broadcastEval(`
                        const thisChan = ${inspect(chan)};
                        const msg = "${mess}";
                        if (this.channels.has(thisChan)) {
                            this.sendMsg(thisChan, msg, ${inspect(args)});
                        }
                    `);
                }
            }
        } catch (e) {
            // Probably broken because it's not started yet
            console.log(`[${client.myTime()}] I couldn't send a log:\n${e}`);
        }
    };

    client.sendMsg = (chanID, msg, options={}) => {
        msg = msg.replace(/"\|"/g, '\n').replace(/\|:\|/g, "'");
        client.channels.get(chanID).send(msg, options);
    };

    /*
     *  CHANGELOG MESSAGE
     *  Send a changelog message to the specified channel
     */
    client.sendChangelog = (clMessage) => {
        clMessage = clMessage.replace(/\n/g, '"|"');
        if (client.config.changelog.sendChangelogs) {
            const clChan = client.config.changelog.changelogChannel;
            if (client.channels.has(clChan)) {
                client.sendMsg(clChan, clMessage);
            } else {
                try {
                    clMessage = clMessage.replace(/'/g, '|:|');
                    client.shard.broadcastEval(`
                        const clMess = '${clMessage}';
                        if (this.channels.has('${clChan}')) {
                            this.sendMsg('${clChan}', clMess);
                        } 
                    `);
                } catch (e) {
                    console.log(`[${client.myTime()}] I couldn't send a log:\n${e}`);
                }
            }
        }
    };


    /*
     * ANNOUNCEMENT MESSAGE
     * Sends a message to the set announcement channel
     */
    client.announceMsg = async (guild, announceMsg, channel='') => {
        const guildSettings = await client.guildSettings.findOne({where: {guildID: guild.id}, attributes: ['announceChan']});
        const guildConf = guildSettings.dataValues;
        let guildChannel;

        let announceChan = guildConf.announceChan;
        if (channel !== '') {
            announceChan = channel;
        }

        if (guild.channels.exists('name', announceChan)) {
            guildChannel = await guild.channels.find('name', announceChan);
            if (guildChannel.permissionsFor(guild.me).has(["SEND_MESSAGES", "VIEW_CHANNEL"])) {
                await guildChannel.send(announceMsg).catch(console.error);
            } else {
                return;
            }
        } else {
            return;
        }
    };

    /*
     * Loads the given command
     */
    client.loadCommand = (commandName) => {
        try {
            const cmd = new (require(`../commands/${commandName}`))(client);
            client.commands.set(cmd.help.name, cmd);
            cmd.conf.aliases.forEach(alias => {
                client.aliases.set(alias, cmd.help.name);
            });
            return false;
        } catch (e) {
            return `Unable to load command ${commandName}: ${e}`;
        }
    };

    /*
     * Unloads the given command
     */
    client.unloadCommand = async (command) => {
        client.commands.delete(command);
        client.aliases.forEach((cmd, alias) => {
            if (cmd === command) client.aliases.delete(alias);
        });
        delete require.cache[require.resolve(`../commands/${command.help.name}.js`)];
        return false;
    };

    /*
     * Combines the last two, and reloads a command
     */
    client.reloadCommand = async (commandName) => {
        let command;
        if (client.commands.has(commandName)) {
            command = client.commands.get(commandName);
        } else if (client.aliases.has(commandName)) {
            command = client.commands.get(client.aliases.get(commandName));
        }
        if (!command) throw new Error(`The command \`${commandName}\` doesn"t seem to exist, nor is it an alias. Try again!`);

        let response = await client.unloadCommand(command);
        if (response) {
            throw new Error(`Error Unloading: ${response}`);
        } else {
            response = client.loadCommand(command.help.name);
            if (response) {
                throw new Error(`Error Loading: ${response}`);
            }
        }
        return command.help.name;
    };

    // Reloads all commads (event if they were not loaded before)
    // Will not remove a command it it's been loaded, 
    // but will load a new command it it's been added
    client.reloadAllCommands = async () => {
        client.commands.keyArray().forEach(c => {
            client.unloadCommand(c);
        });
        const cmdFiles = await readdir('./commands/');
        const coms = [], errArr = [];
        cmdFiles.forEach(f => {
            try {
                const cmd = new(require(`../commands/${f}`))(client);
                if (f.split(".").slice(-1)[0] !== "js") {
                    errArr.push(f);
                } else if (cmd.help.category === "SWGoH" && !client.swgohAPI) {
                    errArr.push(f);
                } else {
                    client.loadCommand(cmd.help.name);
                    coms.push(cmd.help.name);
                }
            } catch (e) {
                console.log('Error: ' + e);
                errArr.push(f);
            }
        });
        return [coms, errArr];
    };



    /*
      SINGLE-LINE AWAITMESSAGE
      A simple way to grab a single reply, from the user that initiated
      the command. Useful to get "precisions" on certain things...
      USAGE
      const response = await client.awaitReply(msg, "Favourite Color?");
      msg.reply(`Oh, I really love ${response} too!`);
      */
    client.awaitReply = async (msg, question, limit = 60000) => {
        const filter = m => m.author.id === msg.author.id;
        await msg.channel.send(question);
        try {
            const collected = await msg.channel.awaitMessages(filter, {max: 1, time: limit, errors: ["time"]});
            return collected.first().content;
        } catch (e) {
            return false;
        }
    };

    /*
      MESSAGE CLEAN FUNCTION
      "Clean" removes @everyone pings, as well as tokens, and makes code blocks
      escaped so they're shown more easily. As a bonus it resolves promises
      and stringifies objects!
      This is mostly only used by the Eval and Exec commands.
      */
    client.clean = async (client, text) => {
        if (text && text.constructor.name == "Promise")
            text = await text;
        if (typeof evaled !== "string")
            text = inspect(text, {
                depth: 0
            });

        text = text
            .replace(/`/g, "`" + String.fromCharCode(8203))
            .replace(/@/g, "@" + String.fromCharCode(8203))
            .replace(client.token, "mfa.VkO_2G4Qv3T--NO--lWetW_tjND--TOKEN--QFTm6YGtzq9PH--4U--tG0");

        return text;
    };

    /* MISCELANEOUS NON-CRITICAL FUNCTIONS */

    String.prototype.toProperCase = function() {
        return this.replace(/([^\W_]+[^\s-]*) */g, function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        });
    };

    // `await wait(1000);` to "pause" for 1 second.
    global.wait = promisify(setTimeout);

    // These 2 simply handle unhandled things. Like Magic. /shrug
    process.on("uncaughtException", (err) => {
        const errorMsg = err.stack.replace(new RegExp(`${__dirname}/`, "g"), "./");
        console.error(`[${client.myTime()}] Uncaught Exception: `, errorMsg);

        // If it's that error, don't bother showing it again
        try {
            if (!errorMsg.startsWith('Error: RSV2 and RSV3 must be clear') && client.config.logs.logToChannel) {
                client.channels.get(client.config.log(`\`\`\`inspect(errorMsg)\`\`\``,{split: true}));
            }
        } catch (e) {
            // Don't bother doing anything
        }
        // Always best practice to let the code crash on uncaught exceptions. 
        // Because you should be catching them anyway.
        process.exit(1);
    });

    process.on("unhandledRejection", err => {
        const errorMsg = err.stack.replace(new RegExp(`${__dirname}/`, "g"), "./");
        console.error(`[${client.myTime()}] Uncaught Promise Error: `, errorMsg);
        try {
            if (client.config.logs.logToChannel) {
                client.channels.get(client.config.logs.channel).send(`\`\`\`${inspect(errorMsg)}\`\`\``,{split: true});
            }
        } catch (e) {
            // Don't bother doing anything
        }
    });

    /*
     *  COMMAND HELP OUTPUT
     *  Input the language and the command, and it'll give ya back the embed object to send
     */
    client.helpOut = (message, command) => {
        const language = message.language;
        const help = language.get(`COMMAND_${command.help.name.toUpperCase()}_HELP`);
        const actions = help.actions.slice();
        let headerString = `**Aliases:** \`${command.conf.aliases.length > 0 ? command.conf.aliases.join(', ') : "No aliases for this command"}\`\n**Description:** ${help.description}\n`;

        // Stick the extra help bit in
        actions.push(language.get('BASE_COMMAND_HELP_HELP', command.help.name.toLowerCase()));
        const actionArr = [];

        actions.forEach(action => {
            const outAct = {};
            const keys = Object.keys(action.args);
            let argString = "";
            if (keys.length > 0) {
                keys.forEach(key => {
                    argString += `**${key}**  ${action.args[key]}\n`;
                });
            }
            if (action.action !== '') {
                outAct.name = action.action;
                outAct.value = `${action.actionDesc === '' ? '' : action.actionDesc} \n\`\`\`${action.usage}\`\`\`${argString}\n`;
                actionArr.push(outAct);
            } else {
                headerString += `\`\`\`${action.usage}\`\`\`${argString}`;
            }
        });
        message.channel.send({embed: {
            "color": 0x605afc,
            "author": {
                "name": language.get('BASE_COMMAND_HELP_HEADER', command.help.name)
            },
            "description": headerString,
            "fields": actionArr
        }});
    };


    /*
     *  MESSAGE SPLITTER
     *  Input an array of strings, and it will put them together so that it 
     *  doesn't exceed the 2000 character limit of Discord mesages.
     */
    client.msgArray = (arr, join='\n', maxLen=1900) => {
        const messages = [];
        arr.forEach((elem) => {
            if  (messages.length === 0) {
                messages.push(elem);
            } else {
                const lastMsgLen = messages[messages.length - 1].length;
                if ((lastMsgLen + elem.length) > maxLen) {
                    messages.push(elem);
                } else {
                    messages[messages.length - 1] = messages[messages.length - 1] + join + elem;
                }
            }
        });
        return messages;
    };

    /*
     * CODE BLOCK MAKER
     * Makes a codeblock with the specified lang for highlighting.
     */
    client.codeBlock = (lang, str) => {
        return `\`\`\`${lang}\n${str}\`\`\``;
    };

    /*
     * isUserID
     * Check if a string of numbers is a valid user.
     */
    client.isUserID = (numStr) => {
        const match = /(?:\\<@!?)?([0-9]{17,20})>?/gi.exec(numStr);
        return match ? true : false;
    };

    /*
     * isAllyCode
     * Check if a string of numbers is a valid ally code.
     */
    client.isAllyCode = (aCode) => {
        const match = aCode.replace(/[^\d]*/g, '').match(/\d{9}/);
        return match ? true : false;
    };

    // Get the ally code of someone that's registered
    client.getAllyCode = async (message, user = 'me') => {
        let uID, uAC;
        if (user === 'me') {
            uID = message.author.id;
            try {
                uAC = await client.allyCodes.findOne({where: {id: uID}});
                return uAC.dataValues.allyCode;
            } catch (e) {
                return false;
            }
        } else if (client.isUserID(user)) {
            uID = user.replace(/[^\d]*/g, '');
            try {
                uAC = await client.allyCodes.findOne({where: {id: uID}});
                return uAC.dataValues.allyCode;
            } catch (e) {
                return false;
            }
        }  else if (client.isAllyCode(user)) {
            return user.replace(/[^\d]*/g, '');
        }  else {
            return false;
        }
    };


    // Get the output from a query
    client.sqlQuery = async (query, args) => {
        return new Promise((resolve, reject) => {
            const connection = mysql.createConnection(client.config.mySqlDB);

            connection.query(query, args, function(err, results) {
                connection.end();
                try {
                    if (err) {
                        console.log('Error in sqlQuery: ' + err);
                        resolve(false);
                    } else {
                        resolve(results);
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
    };



    // Bunch of stuff for the events 
    client.loadAllEvents = async () => {
        let ix = 0;
        const nowTime = momentTZ().subtract(2, 'h').unix();
        const events = await client.guildEvents.findAll();

        const eventList = [];
        events.forEach(event => {
            const eventNameID = event.eventID.split('-');
            const guildID = eventNameID[0];
            
            // Make sure it only loads events for it's shard
            if (client.guilds.keyArray().includes(guildID)) {
                eventList.push(event.dataValues);
            }
        });

        if (eventList.length > 0) {
            eventList.forEach(async event => {
                // If it's past when it was supposed to announce
                if (event.eventDT < nowTime) {
                    await client.guildEvents.destroy({where: {eventID: event.eventID}})
                        .then(() => {})
                        .catch(error => { client.log('ERROR',`Broke trying to delete zombies ${error}`); });
                } else {
                    ix++;
                    client.scheduleEvent(event);
                }
            });
        }
        console.log(`Loaded ${ix} events`);
    };

    // Actually schedule em here
    client.scheduleEvent = async (event) => {
        client.schedule.scheduleJob(event.eventID, parseInt(event.eventDT), function() {
            client.eventAnnounce(event);
        });
    
        if (event.countdown === 'true' || event.countdown === 'yes' || event.countdown === true) {
            const timesToCountdown = [ 2880, 1440, 720, 360, 180, 120, 60, 30, 10, 5 ];
            const nowTime = momentTZ().unix();
            timesToCountdown.forEach(time => {
                const cdTime = time * 60;
                const evTime = event.eventDT / 1000;
                const newTime = (evTime-cdTime-60) * 1000; 
                if (newTime > nowTime) {
                    client.schedule.scheduleJob(`${event.eventID}-CD${time}`, parseInt(newTime) , function() {
                        client.countdownAnnounce(event);                    
                    });
                }
            });
        }
    };

    // Delete em here as needed
    client.deleteEvent = async (eventID) => {
        const event = await client.guildEvents.findOne({where: {eventID: eventID}});

        await client.guildEvents.destroy({where: {eventID: eventID}})
            .then(() => {
                const eventToDel = client.schedule.scheduledJobs[eventID];
                if (!eventToDel) console.log('Broke trying to delete: ' + event);
                eventToDel.cancel();
            })
            .catch(error => { 
                client.log('ERROR',`Broke deleting an event ${error}`); 
            });

        if (event.countdown === 'true' || event.countdown === 'yes') {
            const timesToCountdown = [ 2880, 1440, 720, 360, 180, 120, 60, 30, 10, 5 ];
            const nowTime = momentTZ().unix();
            timesToCountdown.forEach(time => {
                const cdTime = time * 60;
                const evTime = event.eventDT / 1000;
                const newTime = (evTime-cdTime-60) * 1000; 
                if (newTime > nowTime) {
                    const eventToDel = client.schedule.scheduledJobs[`${eventID}-CD${time}`];
                    eventToDel.cancel();
                }
            });
        }
    };
    
    // To stick into node-schedule for each countdown event
    client.countdownAnnounce = async (event) => {
        let eventName = event.eventID.split('-');
        const guildID = eventName.splice(0, 1)[0];
        eventName = eventName.join('-');
    
        const guildSettings = await client.guildSettings.findOne({where: {guildID: guildID}, attributes: Object.keys(client.config.defaultSettings)});
        const guildConf = guildSettings.dataValues;
    
        var timeToGo = momentTZ.duration(momentTZ().diff(momentTZ(parseInt(event.eventDT)), 'minutes') * -1, 'minutes').format(`h [${client.languages[guildConf.language].getTime('HOUR', 'SHORT_SING')}], m [${client.languages[guildConf.language].getTime('MINUTE', 'SHORT_SING')}]`);
        var announceMessage = client.languages[guildConf.language].get('BASE_EVENT_STARTING_IN_MSG', eventName, timeToGo);
    
        if (guildConf["announceChan"] != "" || event.eventChan !== '') {
            if (event['eventChan'] && event.eventChan !== '') { // If they've set a channel, use it
                client.announceMsg(client.guilds.get(guildID), announceMessage, event.eventChan);
            } else { // Else, use the default one from their settings
                client.announceMsg(client.guilds.get(guildID), announceMessage);
            }
        }
    };
    
    // To stick into node-schedule for each full event
    client.eventAnnounce = async (event) => {
        // Parse out the eventName and guildName from the ID
        let eventName = event.eventID.split('-');
        const guildID = eventName.splice(0, 1)[0];
        eventName = eventName.join('-');
    
        const guildSettings = await client.guildSettings.findOne({where: {guildID: guildID}, attributes: Object.keys(client.config.defaultSettings)});
        const guildConf = guildSettings.dataValues;
    
        let repTime = false, repDay = false;
        let newEvent = {};
        const repDays = event.repeatDays;

        if (event.countdown === 'yes') {
            event.countdown = 'true';
        } else if (event.countdown === 'no') {
            event.countdown = 'false';
        }

        // Announce the event
        var announceMessage = `**${eventName}**\n\n${event.eventMessage}`;
        if (guildConf["announceChan"] != "" || event.eventChan !== '') {
            if (event['eventChan'] && event.eventChan !== '') { // If they've set a channel, use it
                try {
                    client.announceMsg(client.guilds.get(guildID), announceMessage, event.eventChan);
                } catch (e) {
                    client.log('ERROR', 'Broke trying to announce event with ID: ${event.eventID} \n${e}');
                }
            } else { // Else, use the default one from their settings
                client.announceMsg(client.guilds.get(guildID), announceMessage);
            }
        }
    
        // If it's got any left in repeatDays
        if (repDays.length > 0) {    
            repDay = true;        
            let eventMsg = event.eventMessage;
            // If this is the last time, tack a message to the end to let them know it's the last one
            if (repDays.length === 1) {
                eventMsg += client.languages[guildConf.language].get('BASE_LAST_EVENT_NOTIFICATION');
            }
            newEvent = {
                "eventID": event.eventID,
                "eventDT": (momentTZ(parseInt(event.eventDT)).add(parseInt(repDays.splice(0, 1)), 'd').unix()*1000),
                "eventMessage": eventMsg,
                "eventChan": event.eventChan,
                "countdown": event.countdown,
                "repeat": {
                    "repeatDay": 0,
                    "repeatHour": 0,
                    "repeatMin": 0
                },
                "repeatDays": repDays
            };
        // Else if it's set to repeat 
        } else if (event['repeat'] && (event.repeat['repeatDay'] !== 0 || event.repeat['repeatHour'] !== 0 || event.repeat['repeatMin'] !== 0)) { // At least one of em is more than 0
            repTime = true;
            newEvent = {
                "eventID": event.eventID,
                "eventDT": (momentTZ(parseInt(event.eventDT)).add(event.repeat['repeatDay'], 'd').add(event.repeat['repeatHour'], 'h').add(event.repeat['repeatMin'], 'm').unix()*1000),
                "eventMessage": event.eventMessage,
                "eventChan": event.eventChan,
                "countdown": event.countdown,
                "repeat": {
                    "repeatDay": event.repeat['repeatDay'],
                    "repeatHour": event.repeat['repeatHour'],
                    "repeatMin": event.repeat['repeatMin']
                },
                "repeatDays": []
            };
        }  
        await client.guildEvents.destroy({where: {eventID: event.eventID}})
            .then(async () => {
                // If it's supposed to repeat, go ahead and put it back in    
                if (repTime || repDay) {
                    await client.guildEvents.create(newEvent)
                        .then(() => {
                            client.scheduleEvent(newEvent);
                        })
                        .catch(error => { 
                            client.log('ERROR',`Broke trying to replace old event ${error}`); 
                        });
                }
            })
            .catch(error => { client.log('ERROR',`Broke trying to delete old event ${error}`); });
    };
};

