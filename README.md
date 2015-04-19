ssh2shell
=========
[![NPM](https://nodei.co/npm/ssh2shell.png?downloads=true&&downloadRank=true&stars=true)](https://nodei.co/npm/ssh2shell/)

Wrapper class for [ssh2](https://www.npmjs.org/package/ssh2) shell command.

*This class enables the following functionality:*
* Run multiple commands sequentially within the context of the previous commands result.
* SSH tunnelling using nested host objects.
* When tunnelling each host has its own connection parameters, commands, command handlers, event handlers and debug or verbose settings.
* Supports `sudo`, `sudo su` and `su user` commands.
* Supports changeing default promt matching regular expressions for different prompt requiements
* Ability to respond to prompts resulting from a command as it is being run.
* Ability to check the last command and conditions within the response text before the next command is run.
* Performing actions based on command/response tests like adding or removing commands, sending notifications or processing of command response text.
* See progress messages handled by msg.send: either static (on events) or dynamic (from event handlers) or verbose (each command response) and debug output (progress logic output).
* Use full session response text in the end event (calling host.onEnd function) triggered when each host connection is closed.
* Run commands that are processed as notification messages to either the full session text or the msg.send function and not run in the shell.
* Add event handlers either to the class or within host object definitions.
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
  standardPrompt:     "$%#>",//optional default:"$#>"
  passwordPrompt:     ":",//optional default:":"
  passphrasePrompt:   ":",//optional default:":"
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
   //stream object used  to respond to the timeout without having to close the connection
   //connection object gives access to close the shell using connection.end()
  },
  onEnd:               function( sessionText, sshObj ) {
   //optional code to run at the end of the session
   //sessionText is the full text for this hosts session
  }
};
``` 

Prompt detection override
-------------------------
The following objects have been added to the host object making it possable to override Prompt string values used with regular expressions to detect the prompt on the server and what type it is. Being able to change these values enables you to easily manage all sorts of prompt options for any number of servers all configured slightly different or even completely different be it vi one to one connections or a more complex tunneling configuration each host will have its own values based on the configuration you make in you host object. 

These do not need to be altered or even added to the host object because internaly the default will be set to the values below. If it finds you have provided a new value then that value will override the interal default.

``` 
  standardPrompt:     "$%#>",//optional default:"$#>"
  passwordPrompt:     ":",//optional default:":"
  passphrasePrompt:   ":",//optional default:":"
 ``` 
 
Tests:
-----
```javascript
//single host test
cp .env-example .env

//change .env values to valid host settings then run
node test/devtest.js

//multiple nested hosts
//requires the additional details added to .env file for each server
//my tests were done using three VM hosts
node test/tunneltest.js

//test the command idle time out timer
node test/timeouttest.js

//Test multiple sudo and su combinations for changing user
//Issue #10
//Also test promt detection with no password requested 
//Issue #14
node test/sudosutest.js

//test using notification commands as the last command
//Issue #11
node test/notificationstest.js
```

Usage:
======
Connecting to a single host:
----------------------------

*How to:*
* Use an .env file for server values loaded by dotenv from the root of the project.
* Connect using a key pair with passphrase.
* Use sudo su with user password.
* Set commands.
* Test the response of a command and add more commands and notifications in the host.onCommandComplete event handler.
* Use the two notification types in the commands array.
* Use msg: notifications to track progress in the console as the process completes.
* Email the final full session text to yourself.
* Trigger an event handler by using this.emit for known event handlers: error and msg.

(will require a package json with ssh2shell, dotenv and email defined as dependencies)

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
var Email = require('email');

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
  "msg:changing directory",
  "cd ~/",
  "ls -l",
  "msg:Confirming the current path",
  "echo $(pwd)",
  "msg:Getting the directory listing to confirm the extra command was added",
  "ls -l",
  "`All done!`"
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
   sshObj.commands.unshift("msg:The command and response check worked. Added another cd command.");
   sshObj.commands.unshift("cd .ssh");
  }
  //we are listing the dir so output it to the msg handler
  else if (command === "ls -l"){      
   sshObj.msg.send(response);
  }
 },
 onEnd: function( sessionText, sshObj ) {
  //email the session text instead of outputting it to the console
  var sessionEmail = new Email({ 
    from: "me@example.com", 
    to:   "me@example.com", 
    subject: "Automated SSH Session Response",
    body: "\nThis is the full session responses for " + sshObj.server.host + ":\n\n" + sessionText
  });
  this.emit('msg', "Sending session response email");
  //same as sshObj.msg.send("Sending session response email");
  
  // if callback is provided, errors will be passed into it
  // else errors will be thrown
  sessionEmail.send(function(err){ this.emit('error', err, 'Email'); });
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
This example shows two hosts (server2, server3) that are connected to through server1 by adding them to server1.hosts array.
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

*The nested process:*

1. The primary host (server1) is connected and all its commands completed. 
2. Server1.hosts array is checked for other hosts and the next host popped off the array.
3. Server1 is stored for use later and server2's host object is loaded as the current host.
4. A connection to server2 is made using its server parameters
5. Server2's commands are completed and server2.hosts array is checked for other hosts.
6. With no hosts found the connection to server2 is closed triggering an end event (calling server2.onEnd function if defined).
5. Server1 host object is reloaded as the current host object and server2 host object discarded.
6. Server1.hosts array is checked for other hosts and the next host popped off the array.
7. Server1's host object is stored again and server3's host object is loaded as the current host.
8. Server3 is connected to and it completes its process.
9. Server3.hosts is checked and with no hosts found the connection is closed and the end event is triggered.
9. Server1 is loaded for the last time.
10. With no further hosts to load the connection is closed triggering an end event for the last time.
6. As all sessions are closed the process ends.


*Note:* 
* A host object needs to be defined before it is added to another host.hosts array.
* Only the primary host objects connected, ready and closed messages will be used by ssh2shell.

*How to:*
* Define nested hosts
* Use unique host connection settings for each host
* Defining different commands and command event handlers for each host
* Sharing duplicate functions between host objects
* What host object attributes you can leave out of primary and secondary host objects
* Unique event handlers set in host objects, common event handler set on class instance

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
 
//functions used by all hosts
var msg = {
  send: function( message ) {
    console.log(message);
  }
 }

//Host objects:
var host1 = {
  server:              conParamsHost1,
  commands:            [
    "msg:connected to host: passed. Listing dir.",
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
    "msg:Changing to root dir",
    "cd ~/",
    "msg:Listing dir",
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
    "msg:Listing root dir",
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

* Adding msg command `"msg:Doing something"` to your commands array at key points will help you track the sequence of what has been done as the process runs. (see examples)
* `Error: Unable to parse private key while generating public key (expected sequence)` is caused by the passphrase being incorrect. This confused me because it doesn't indicate the passphrase was the problem but it does indicate that it could not decrypt the private key. 
 * Recheck your passphrase for typos or missing chars.
 * Try connecting manually to the host using the exact passhrase used by the code to confirm it works.
 * I did read of people having problems with the the passphrase or password having an \n added when used from an external file causing it to fail. They had to add .trim() when setting it.
* If your password is incorrect the connection will return an error.
* There is an optional debug setting in the host object that will output progress information when set to true and passwords for failed authentication of sudo commands and tunnelling. `host.debug = true`
* The class now has an idle time out timer (default:5000ms) to stop unexpected command prompts from causing the process hang without error. The default time out can be changed by setting the host.idleTimeOut with a value in milliseconds. (1000 = 1 sec)

Authentication:
---------------
* Each host authenticates with its own host.server parameters.
* When using key authentication you may require a valid passphrase if your key was created with one. 

Sudo and su Commands:
--------------
It is possible to use `sudo [command]`, `sudo su`, `su [username]` and `sudo -u [username] -i`. Sudo commands uses the password for the user that is accessing the server and is handled by SSH2shell. Su on the other hand uses the password of root or the other user (`su seconduser`) and requires you detect the password prompt in onCommandProcessing.

See: [su VS sudo su VS sudo -u -i](http://johnkpaul.tumblr.com/post/19841381351/su-vs-sudo-su-vs-sudo-u-i) for clarification about the difference between the commands.

See: test/sudosutest.js for a working code example.

Notification commands:
----------------------
There are two notification commands that can be added to the command array but are not processed in the shell.

1. "msg:This is a message intended for monitoring the process as it runs" The text after msg: is outputted through whatever method the msg.send function uses. It might be to the console or a chat room or a log file but is considered direct response back to whatever or whoever is watching the process to notify them of what is happening.
2. "\`SessionText notification\`" will add the message between the \` to the sessionText variable that contains all of the session responses and is passed to the end event handler (host.onEnd()). The reason for not using echo or printf commands is that you see both the command and the message in the sessionTest result which is pointless when all you want is the message.

Verbose and Debug:
------------------
* When verbose is set to true each command response raises a msg event (calls host.msg.send(message)) when the command completes.
* When debug is set to true in a host object process messages raises a msg event (calls host.msg.send(message)) to help identify what the internal process of each step was. 

Responding to command prompts:
----------------------
When running commands there are cases that you might need to respond to specific prompt that results from the command being run.
The command response check method is the same as in the example for the host.onCommandComplete event handler but in this case we use it in the host.onCommandProcessing event handler and stream.write to send the response. If you want to terminate the connection then se the 
The stream object is available in the host.onCommandProcessing event handler to output the response to the prompt directly as follows:

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
 ssh2shell.on ('commandProcessing', function onCommandProcessing( command, response, sshObj, stream ) {
   //Check the command and prompt exits and respond with a 'y'
   if (command == "apt-get install nano" && response.indexOf("[y/N]?") != -1 ) {
     sshObj.msg.send('Sending install nano response');
     stream.write('y\n');
   }
 };

```
The other alternative is to use the host.onCommandTimeout event handler but it will be delayed by the idleTimout value

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
There are a number of event handlers that enable you to add your own code to be run when those events are triggered. You do not have to add event handlers unless you want to add your own functionality as the class already has default handlers defined. 

There are two ways to add event handlers:

1. Add handller functions to the host object (See Requirments) these event handlers will only be run for that host.
 * Connect, ready and close are not available for definition in the hosts object 
2. Add handlers to the class instance which will be run every time the event is triggered for all hosts.
 * The default event handlers of the class will call the host object event handler functions if they are defined.

**Note:** any event handlers you add to the class instance are run as well as any other event handlers defined for the same event.

*Further reading:* [node.js event emitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)

**Class Instance Event Definitions:**

```javascript
ssh2shell.on ("connect", function onConnect() { 
 //default: outputs primaryHost.connectedMessage
});

ssh2shell.on ("ready", function onReady() { 
 //default: outputs primaryHost.readyMessage
});

ssh2shell.on ("msg", function onMsg( message ) {
 //default: outputs the message to the host.msg.send function. If undefined output is to console.log
 //message is the text to ouput.
});

ssh2shell.on ("commandProcessing", function onCommandProcessing( command, response, sshObj, stream )  { 
 //default: runs host.onCommandProcessing function if defined 
 //command is the command that is being processed
 //response is the text buffer that is being loaded with each data event from the stream
 //sshObj is the host object
 //stream is the session stream
});
    
ssh2shell.on ("commandComplete", function onCommandComplete( command, response, sshObj ) { 
 //default: runs host.onCommandComplete function if defined 
 //command is the command that was compleated
 //response is the full test response from the command
 //sshObj is the host object
});
    
ssh2shell.on ("commandTimeout", function onCommandTimeout( command, response, stream, connection ) { 
 //default: runs host.onCommandTimeout function if defined if not the buffer is added to sessionText
 //the error is outputed to the msg event and the connection is closed
 //command is the command that timed out
 //response is the text buffer up to the time out
 //stream is the session stream
 //connection is the main ssh2 connection object
});

ssh2shell.on ("end", function onEnd( sessionText, sshObj ) { 
 //default: run host.onEnd function if defined 
 //sessionText is the full text response from the session for the host
 //sshObj is the host object for this session
});

ssh2shell.on ("close", function onClose(had_error) { 
 //default: outputs primaryHost.closeMessage or error if one was received
 //had_error indicates an error was recieved on close
});

ssh2shell.on ("error", function onError(err, type, close, callback) {
 //default: Outputs the error, runs the callback if defined and closes the connection
 //Close and callback should be set by default to close = false and callback = undefined
 //not all error events will pass those two parameters to the evnt handler.
 //err is the error message received
 //type is a string identifying the source of the error
 //close is a bollean value indicating if the error will close the session
 //callback a fuction that will be run by the default handler
});
```
