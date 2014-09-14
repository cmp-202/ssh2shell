ssh2shell
=========
[![NPM](https://nodei.co/npm/ssh2shell.png?downloads=true&&downloadRank=true&stars=true)](https://nodei.co/npm/ssh2shell/)

Wrapper class for [ssh2](https://www.npmjs.org/package/ssh2) shell command.

*This class enables the following functionality:*
* Run multiple commands sequentially within the context of the previous commands result.
* SSH tunnelling using nested host objects.
* When tunnelling each host has its own connection parameters, commands, command handlers, event handlers and debug or verbose settings.
* Supports `sudo`, `sudo su` and `su user` commands.
* Ability to respond to prompts resulting from a command as it is being run.
* Ability to check the last command and conditions within the response text before the next command is run.
* Performing actions based on command/response tests like adding or removing commands, sending notifications or processing of command response text.
* See progress messages handled by msg.send: either static (on events) or dynamic (from callback functions) or verbose (each command response) and debug output (progress logic output).
* Use full session response text in the onEnd callback function triggered when each host connection is closed.
* Run commands that are processed as notification messages to either the full session text or the msg.send function and not run in the shell.
* Added default event handlers either to the class or within host object definitions.
* Create bash scripts on the fly, run them and then remove them.

Code:
-----
The Class is written in coffee script and can be found here: `./src/ssh2shell.coffee`. It has comments not found in the build output javascript file `./lib/ssh2shell.js`.
 
Installation:
------------
```
npm install ssh2shell
```

Requirements:
------------
The class expects an object with the following structure to be passed to its constructor:
```javascript
//Host object
host = {
  server:              {       
    host:         "IP Address",
    port:         "external port number",
    userName:     "user name",
    password:     "user password",
    passPhrase:   "privateKeyPassphrase", //optional default:""
    privateKey:   require('fs').readFileSync('/path/to/private/key/id_rsa'), //optional default:""
  },
  hosts:               [Array, of, nested, host, configs, objects], //optional default:[]
  commands:            ["Array", "of", "command", "strings"],
  msg:                 {
    send: function( message ) {
      //message handler code
    }
  }, 
  verbose:             true/false,  //optional default:false
  debug:               true/false,  //optional default:false
  idleTimeOut:         5000,        //optional: value in milliseconds (default:5000)
  connectedMessage:    "Connected", //optional: on Connected message
  readyMessage:        "Ready",     //optional: on Ready message
  closedMessage:       "Closed",    //optional: on Close message
  
  //optional event handlers defined for a host that will be called by the default event handlers
  //of the class
  onCommandProcessing: function( command, response, sshObj, stream ) {
   //optional code to run during the procesing of a command 
   //command is the command being run
   //response is the text buffer that is still being loaded with each data event
   //sshObj is this object and gives access to the current set of commands
   //stream object allows strea.write access if a command requires a response
  },
  onCommandComplete:   function( command, response, sshObj ) {
   //optional code to run on the completion of a command
   //response is the full response from the command completed
   //sshObj is this object and gives access to the current set of commands
  },
  onCommandTimeout:    function(command, response, sshObj, stream, connection) {
   //optional code for responding to command timeout
   //response is the text response from the command up to it timing out
   //stream object allows being able to respond to the timeout without having to close the connection
   //connection object gives access to close the shell using connection.end()
  },
  onEnd:               function( sessionText, sshObj ) {
   //optional code to run at the end of the session
   //sessionText is the full text for this hosts session
  }
};

``` 
 
Test:
-----
```javascript
//single host test
cp .env-example .env

//change .env values to valid host settings then run
node test/devtest.js

//test the idle time out timer
node test/timeouttest.js

//multiple nested hosts
//requires the additional details added to .env file for each server
//my tests were done using three VM hosts
node test/tunneltest.js
```

Usage:
======
Connecting to a single host:
----------------------------

*How to:*
* Use sudo su with user password.
* Set commands.
* Test the response of a command and add more commands and notifications in the onCommandComplete callback function.
* Use the two notification types in the commands array.
* Connect using a key pair with passphrase.
* Use an .env file for server values loaded by dotenv from the root of the project.

*.env*
```
HOST=192.168.0.1
PORT=22
USER_NAME=myuser
PASSWORD=mypassword
PRIV_KEY_PATH=~/.ssh/id_rsa
PASS_PHRASE=myPassPhrase
```

*app.js*
```javascript
var dotenv = require('dotenv');
dotenv.load();

var host = {
 server:              {     
  host:         process.env.HOST,
  port:         process.env.PORT,
  userName:     process.env.USER_NAME,
  password:     process.env.PASSWORD,
  passPhrase:   process.env.PASS_PHRASE,
  privateKey:   require('fs').readFileSync(process.env.PRIV_KEY_PATH)
 },
 commands:      [
  "`This is a message that will be added to the full sessionText`",
  "msg:This is a message that will be handled by the msg.send code",
  "echo $(pwd)",
  "sudo su",
  "cd ~/",
  "ls -l",
  "echo $(pwd)",
  "ls -l"
 ],
 msg: {
  send: function( message ) {
   console.log(message);
  }
 },
 onCommandComplete: function( command, response, sshObj ) {
  //confirm it is the root home dir and change to root's .ssh folder
  if (command === "echo $(pwd)" && response.indexOf("/root") != -1 ) {
   //unshift will add the command as the next command, use push to add command as the last command
   sshObj.commands.unshift("msg:The command and response check worked, another command was added before the next ls command.");
   sshObj.commands.unshift("cd .ssh");
  }
  //we are listing the dir so output it to the msg handler
  else if (command === "ls -l"){      
   sshObj.msg.send(response);
  }
 },
 onEnd: function( sessionText, sshObj ) {
  //show the full session output. This could be emailed or saved to a log file.
  sshObj.msg.send("\nThis is the full session responses:\n" + sessionText);
 }
};

//Create a new instance
var SSH2Shell = require ('ssh2shell'),
    SSH       = new SSH2Shell(host);

//Start the process
SSH.connect();

```

Tunnelling nested host objects:
---------------------------------
SSH tunnelling has been incorporated into core of the class process enabling nested host objects.
The new `hosts: [ host1, host2]` setting can make multiple sequential host connections possible and each host object can also contain nested hosts.
Each host config object has its own server settings, commands, command handlers and event handlers. The msg handler can be shared between all objects.
This a very robust and simple multi host configuration method.

**Tunnelling Example:**
This example shows two hosts (server2, server3) that are connected to through server1 by defining them first then adding them to the hosts array in server 1.
```
server1.hosts = [server2, server3] 
server2.hosts = []
server3.hosts = []
```
*The following would also be valid:*
```
server1.hosts = [server2]
server2.hosts = [server3]
server3.hosts = []
```

*The process:*

1. The primary host (server1) is connected and all its commands completed. 
2. Once complete a connection to server2 is made using its server parameters, its commands are completed and handled by its command callback functions, then connection to server2 closed triggering its onEnd callback.
3. Server3 is connected to and it completes its process and the connection is closed.
4. Control is returned to server1 and its connection is closed triggering its onEnd callback.
5. As all sessions are closed the process ends.

*Note:* 

* A host object needs to be defined before it is added to another host.hosts array.
* Only the primary host objects connected,ready and closed messages will be used by ssh2shell.

*How to:*
* How to set up nested hosts
* Use unique host connection settings for each host
* Defining different commands and command handlers for each host
* Sharing duplicate functions between host objects
* What host object attributes you can leave out of primary and secondary host objects
* Unique event handlers set in host objects common event handler set on class instance

```javascript
var dotenv = require('dotenv');
dotenv.load();

//Host connection and authentication parameters
var conParamsHost1 = {
  host:         process.env.SERVER1_HOST,
  port:         process.env.SERVER1_PORT,
  userName:     process.env.SERVER1_USER_NAME,
  password:     process.env.SERVER1_PASSWORD,
  passPhrase:   process.env.SERVER1_PASS_PHRASE,
  privateKey:   require('fs').readFileSync(process.env.SERVER1_PRIV_KEY_PATH)
 },
 conParamsHost2 = {
  host:         process.env.SERVER2_HOST,
  port:         process.env.SERVER2_PORT,
  userName:     process.env.SERVER2_USER_NAME,
  password:     process.env.SERVER2_PASSWORD,
  passPhrase:   process.env.SERVER2_PASS_PHRASE,
  privateKey:   ''
 },
 conParamsHost3 = {
  host:         process.env.SERVER3_HOST,
  port:         process.env.SERVER3_PORT,
  userName:     process.env.SERVER3_USER_NAME,
  password:     process.env.SERVER3_PASSWORD,
  passPhrase:   process.env.SERVER3_PASS_PHRASE,
  privateKey:   ''
 }
 
//Callback functions used by all hosts
var msg = {
  send: function( message ) {
    console.log(message);
  }
 }

//Host objects:
var host1 = {
  server:              conParamsHost1,
  commands:            [
    "msg:connected to host: passed",
    "ls -l"
  ],
  msg:                 msg,
  connectedMessage:    "Connected to Primary host1",
  readyMessage:        "Running commands Now",
  closedMessage:       "Completed",
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if (command == "ls -l"){      
      sshObj.msg.send(response);
    }
  }
},

host2 = {
  server:              conParamsHost2,
  commands:            [
    "msg:connected to host: passed",
    "sudo su",
    "cd ~/",
    "ls -l"
  ],
  msg:                 msg,
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if (command == "sudo su"){      
      sshObj.msg.send("Just ran a sudo su command");
    }
  }
},

host3 = {
  server:              conParamsHost3,
  commands:            [
    "msg:connected to host: passed",
    "sudo su",
    "cd ~/",
    "ls -l"
  ],
  msg:                 msg,
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if (command.indexOf("cd") != -1){  
      sshObj.msg.send("Just ran a cd command:");    
      sshObj.msg.send(response);
    }
  }
}

//Set the two hosts you are tunnelling to through host1
host1.hosts = [ host2, host3 ];

//or the alternative nested tunnelling method outlined above:
//host2.hosts = [ host3 ];
//host1.hosts = [ host2 ];

//Create the new instance
var SSH2Shell = require ('ssh2shell'),
    SSH       = new SSH2Shell(host1);

//Add an on end event handler used by all hosts
SSH.on ('end', function( sessionText, sshObj ) {
  //show the full session output. This could be emailed or saved to a log file.
  sshObj.msg.send("\nSession text for " + sshObj.server.host + ":\n" + sessionText);
 });

//Start the process
SSH.connect();
 
```

Trouble shooting:
-----------------

* `Error: Unable to parse private key while generating public key (expected sequence)` is caused by the passphrase being incorrect. This confused me because it doesn't indicate the passphrase was the problem but it does indicate that it could not decrypt the private key. 
 * Recheck your passphrase for typos or missing chars.
 * Try connecting manually to the host using the exact passhrase used by the code to confirm it works.
 * I did read of people having problems with the the passphrase or password having an \n added when used from an external file causing it to fail. They had to add .trim() when setting it.
* If your password is incorrect the connection will return an error.
* There is an optional debug setting in the host object that will output progress information when set to true and passwords for failed authentication of sudo commands and tunnelling. `host.debug = true`
* The class now has an idle time out timer (default:5000ms) to stop unexpected command prompts from causing the process hang without error. The default time out can be changed by setting the host.idleTimeOut with a value in milliseconds.

Authentication:
---------------
* Each host authenticates with its own host.server parameters.
* When using key authentication you may require a valid passphrase if your key was created with one. If not set host.server.passPhrase to ''

Sudo Commands:
--------------
If sudo su is detected an extra exit command will be added to close the session correctly once all commands are complete.

If your sudo password is incorrect an error message will be returned and the session closed. 
If debug is set to true the password that was used will also be returned.

**Su as another user:** Use the **Responding to command prompts** method outline below to detect the `su username` command and the `/password:\s/i` prompt then respond with user password via stream.write.

Notification commands:
----------------------
There are two notification commands that can be added to the command array but are not processed in the shell.

1. "msg:This is a message intended for monitoring the process as it runs" The text after `msg:` is outputted through whatever method the msg.send function uses. It might be to the console or a chat room or a log file but is considered direct response back to whatever or whoever is watching the process to notify them of what is happening.
2. "\`SessionText notification\`" will add the message between the \` to the sessionText variable that contains all of the session responses and is passed to the onEnd callback function. The reason for not using echo or printf commands is that you see both the command and the message in the sessionTest result which is pointless when all you want is the message.

Verbose and Debug:
------------------
* When verbose is set to true each command response is passed to the msg.send function when the command completes.
* When debug is set to true in a host object process messages will be outputted to the msg.send function to help identify what the internal process is. 

Responding to command prompts:
----------------------
When running commands there are cases that you might need to respond to specific prompt that results from the command being run.
The command response check method is the same as in the example for the onCommandComplete callback but in this case we use it in the onCommandProcessing callback and stream.write to send the response. If you want to terminate the connection then se the 
The stream object is available in the onCommandProcessing function to output the response to the prompt directly as follows:

```javascript
//in the host object definition that will be used only for that host
host.onCommandProcessing = function( command, response, sshObj, stream ) {
   //Check the command and prompt exits and respond with a 'y'
   if (command == "apt-get install nano" && response.indexOf("[y/N]?") != -1 ) {
     sshObj.msg.send('Sending install nano response');
     stream.write('y\n');
   }
 };
 
 //To handle all hosts the same add an event handler to the class instance
 //This will be run in addition to any other handlers defined for this event
 ssh2shell.on ('commandProcessing': function onCommandProcessing( command, response, sshObj, stream ) {
   //Check the command and prompt exits and respond with a 'y'
   if (command == "apt-get install nano" && response.indexOf("[y/N]?") != -1 ) {
     sshObj.msg.send('Sending install nano response');
     stream.write('y\n');
   }
 };

```
The other alternative is to use the onCommandTimeout event handler but it will be delayed by the idleTimout value

```javascript
host.onCommandTimeout = function( command, response, sshObj, stream, connection ) {
   if (response.indexOf("[y/N]?") != -1 ) {
     stream.write('n\n');
   }
 }
```
To terminate the session on such a prompt use connection.end() within the timeout event handler.

Bash scripts on the fly:
------------------------
If the commands you need to run would be better suited to a bash script as part of the process it is possible to generate or get the script on the fly. 
You can echo/printf the script content into a file as a command, ensure it is executable, run it and then delete it.
The other option is to curl or wget the script from a remote location and do the same but this has some risks associated with it. I like to know what is in the script I am running.

```javascript
 host.commands = [ "some commands here",
  "if [ ! -f myscript.sh ]; then printf '#!/bin/bash\n
 #\n
 current=$(pwd);\n
 cd ..;\n
 if [ -f myfile ]; then
  sed \"/^[ \\t]*$/d\" ${current}/myfile | while read line; do\n
    printf \"Doing some stuff\";\n
    printf $line;\n
  done\n
 fi\n' > myscript.sh; 
fi",
  "sudo chmod 700 myscript.sh",
  "./myscript.sh",
  "rm myscript.sh"
]
```

Event Handlers:
---------------
There are a number of event handlers that enable you to add your own code to be run when those events are triggered and there are two ways to add them:

1. To the class instance which will be run every time the event is triggered for all hosts in addition to the existing default handlers.
2. To the host object which will only be run for that host.
 * Connect, ready and close are not available for definition in the hosts object 
 * The default event handlers of the class will call the host object event handler functions if they are defined.

**Note:** any event handlers you add to the class instance are run as well as any other event handlers defined.

[node.js event emitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)

*Default event definitions:*
```javascript
ssh2shell.on ("connect", function onConnect() { [default: outputs primaryHost.connectedMessage] })

ssh2shell.on ("ready", function onReady() { [default: outputs primaryHost.readyMessage] })
      
ssh2shell.on ('commandProcessing', function onCommandProcessing( command, response, sshObj, stream )  { 
 [default: runs host.onCommandProcessing function if defined] 
})
    
ssh2shell.on ('commandComplete', function onCommandComplete( command, response, sshObj ) { 
 [default: runs host.onCommandComplete function if defined] 
})
    
ssh2shell.on ('commandTimeout', function onCommandTimeout( command, response, stream, connection ) { 
 [default: runs host.onCommandTimeout function if defined] 
})

ssh2shell.on ('end', function onEnd( sessionText, sshObj ) { 
 [default: run host.onEnd function if defined] 
})

ssh2shell.on ("close", function onClose(had_error) { [default: outputs primaryHost.closeMessage] })
```
