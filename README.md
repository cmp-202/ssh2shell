ssh2shell
======================

Wrapper class for [ssh2](https://github.com/mscdex/ssh2) shell command.

*This class enables the following functionality:*
* Run multiple commands sequentially within the context of the previous commands result.
* SSH tunnelling to any number of nested hosts.
* When tunnelling each host has its own connection parameters, commands, command handlers, event handlers and debug or verbose settings.
* Supports `sudo`, `sudo su` and `su user` commands.
* Ability to respond to prompts resulting from a command as it is being run.
* Ability to check the last command and conditions within the response text before the next command is run.
* Performing actions based on command/response tests like adding or removing commands, sending notifications or processing of command response text.
* See progress messages handled by msg.send: either static (on events) or dynamic (from callback functions) or verbose (each command response) and debug output (progress logic output).
* Use full session response text in the onEnd callback function triggered when each host connection is closed.
* Run commands that are processed as notification messages to either the full session text or the msg.send function and not run in the shell.
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
```
host = {
  server:             {       
    host:         "[IP Address]",
    port:         "[external port number]",
    userName:     "[user name]",
    password:     "[user password]",
    sudoPassword: "[optional: different sudo password or blank if the same as password]",
    passPhrase:   "[private key passphrase or ""]",
    privateKey:   [require('fs').readFileSync('/path/to/private/key/id_rsa') or ""]
  },
  hosts:               [Array of host configs to connect to from this host],
  commands:           ["Array", "of", "command", "strings"],
  msg:                {
    send: function( message ) {
      [message handler code]
    }
  }, 
  verbose:            true/false,
  debug:              true/false,
  connectedMessage:   "[on Connected message]",
  readyMessage:       "[on Ready message]",
  closedMessage:      "[on Close message]",
  onCommandProcessing: function( command, response, sshObj, stream ) {
    [callback function, optional code to run during the procesing of a command]
  },
  onCommandComplete:   function( command, response, sshObj ) {
    [callback function, optional code to run on the completion of a command]
  },
  onEnd:               function( sessionText, sshObj ) {
    [callback function, optional code to run at the end of the session]
  }
};
``` 

Test:
-----
```
//single host test
cp .env-example .env

//change .env values to valid host settings then run
node test/devtest.js

//multiple nested hosts
//requires the additional details added to .env file for each server
//my tests were done using three VM hosts
node test/tunneltest.js
```

Usage:
------

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
```
var dotenv = require('dotenv');
dotenv.load();

var host = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD,
    passPhrase:   process.env.PASS_PHRASE,
    privateKey:   require('fs').readFileSync(process.env.PRIV_KEY_PATH)
  },
  hosts:              [],
  commands:           [
    "`This is a message that will be added to the full sessionText`",
    "msg:This is a message that will be handled by the msg.send code",
    "echo $(pwd)",
    "sudo su",
    "cd ~/",
    "ll",
    "echo $(pwd)",
    "ll"
  ],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },
  verbose:            false,
  connectedMessage:   "Connected",
  readyMessage:       "Running commands Now",
  closedMessage:      "Completed",
  onCommandProcessing: function( command, response, sshObj, stream ) {
    //nothing to do here
  },
  onCommandComplete:  function( command, response, sshObj ) {
    //confirm it is the root home dir and change to root's .ssh folder
    if (command == "echo $(pwd)" && response.indexOf("/root") != -1 ) {
      //unshift will add the command as the next command, use push to add command as the last command
      sshObj.commands.unshift("msg:This shows that the command and response check worked and that another command was added before the next ll command.");
      sshObj.commands.unshift("cd .ssh");
    }
    //we are listing the dir so output it to the msg handler
    else if (command == "ll"){      
      sshObj.msg.send(response);
    }
  },
  onEnd:              function( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nThis is the full session responses:\n" + sessionText);
  }
};

var SSH2Shell = require ('ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(host);
SSH.connect();

```

Trouble shooting:
-----------------

* `Error: Unable to parse private key while generating public key (expected sequence)` is caused by the passphrase being incorrect. This confused me because it doesn't indicate the passphrase was the problem but it does indicate that it could not decrypt the private key. 
 * Recheck your passphrase for typos or missing chars.
 * Try connecting manually to the host using the exact passhrase used by the code to confirm it works.
 * I did read of people having problems with the the passphrase or password having an \n added when used from an external file causing it to fail. They had to add .trim() when setting it.
* If your password is incorrect the connection will return an error.
* There is now a debug option in the host config that will output progress information.
* There are case when the session hangs waiting for a response it will never get as the result of a command. The callback functions conCommandComplete and onEnd will never trigger and verbose will only output the previous command response.
  * Use the onCommandProcessing command to output debug that will enable you identify the problem and handle it as outlined in **Responding to command prompts**
  ```
    //output all commands buffer responses as it builds
    onCommandProcessing:  function( command, response, sshObj, stream ) {
      sshObj.msg.send( command + ": " + response);
    }
    //or
    //output a specific commands buffer response as it builds
    onCommandProcessing:  function( command, response, sshObj, stream ) {
      if ( command.indexOf('npm install') != -1) {
        sshObj.msg.send( response );
      }
    }
  ```

Authentication:
---------------
* Each host authenticates with its own host.server parameters.
* When using key authentication you may require a valid passphrase if your key was created with one. If not set sshObj.server.passPhrase to ""

Sudo Commands:
--------------
If sudo su is detected an extra exit command will be added to close the session correctly once all commands are complete.

If your sudo password is incorrect an error message will be returned and the session closed. 
If debug is set to true the password that was used will also be returned with the error message when sudo authentication fails.

**Su as another user:** Use the **Responding to command prompts** method outline below to detect the `su username` command and the `/password:\s/i` prompt then respond with user password via stream.write.

Notification commands:
----------------------
There are two notification commands that can be added to the command array but are not processed in the shell.

1. "msg:This is a message intended for monitoring the process as it runs" The text after `msg:` is outputted through whatever method the msg.send function uses. It might be to the console or a chat room or a log file but is considered direct response back to whatever or whoever is watching the process to notify them of what is happening.
2. "\`SessionText notification\`" will add the message between the \` to the sessionText variable that contains all of the session responses and is passed to the onEnd callback function. The reason for not using echo or printf commands is that you see both the command and the message in the sessionTest result which is pointless when all you want is the message.

Verbose and Debug:
--------
* When verbose is set to true each command response is passed to the msg.send function when the command completes.
* When debug is set to true in a host object process messages will be outputted to the msg.send function to help identify what the internal process is. 


Responding to command prompts:
----------------------
When running commands there are cases that you might need to respond to specific prompt that results from the command being run.
The command response check method is the same as in the example for the onCommandComplete callback but in this case we use it in the onCommandProcessing callback and stream.write to send the response.
The stream object is available in the onCommandProcessing function to output the response to the prompt directly as follows:

```
  onCommandProcessing:  function( command, response, sshObj, stream ) {
    //Check the command and prompt exits and respond with a 'y'
    if (command == "apt-get install nano" && response.indexOf("[y/N]?") != -1 ) {
      sshObj.msg.send('Sending install nano response');
      stream.write('y\n');
    }
  }
```

Bash scripts on the fly:
------------------------
If the commands you need to run would be better suited to a bash script as part of the process it is possible to generate or get the script on the fly. 
You can echo/printf the script content into a file as a command, ensure it is executable, run it and then delete it.
The other option is to curl or wget the script from a remote location and do the same but this has some risks associated with it. I like to know what is in the script I am running.

```
 commands: [ "some commands here",
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

Tunnelling nested host objects:
---------------------------------
SSH tunnelling has been incorporated into core of the class process enabling nested host objects.
The the new `hosts: [ host1, host2]` setting can make multiple sequential host connections possible and each host object can also contain nested hosts.
Each host config object has its own server settings, commands, command handlers and event handlers. The msg handler can be shared between all objects.
This a very robust and simple multi host configuration method.

**Tunnelling Example:**
This example shows a primary host (server1) that has two hosts the will be connected to through it (server2, server3).

*The process:*
1. The primary host (server1) is connected and all its commands completed. 
2. Once complete a connection to server2 is made using its server parameters, its commands are completed and handled by its command callback functions, then connection to server2 closed running its onEnd callback.
3. Server3 is connected to and it completes its process and the connection is closed.
4. Control is returned to server1 and its connection is closed triggering its onEnd callback.
5. As all sessions are closed the process ends.

*Note:* A host object needs to be defined before it is added to another host.hosts array.

```
var msg = {
  send: function( message ) {
    console.log(message);
  }
}

//Third host
var server3 = {
  server:              {
    host:         process.env.SERVER3_HOST,
    port:         process.env.SERVER3_PORT,
    userName:     process.env.SERVER3_USER_NAME,
    password:     process.env.SERVER3_PASSWORD,
    passPhrase:   process.env.SERVER3_PASS_PHRASE,
    privateKey:   ''
  },
  hosts:               [],
  commands:            [
    "msg:connected to host: passed",
    "sudo su",
    "cd ~/",
    "ll"
  ],
  msg:                 msg,
  verbose:             true,
  connectedMessage:    "",
  readyMessage:        "",
  closedMessage:       "",
  onCommandProcessing: function( command, response, sshObj, stream ) {
    //nothing to do here
  },
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if (command.indexOf("cd") != -1){  
      sshObj.msg.send("Just ran a cd command:");    
      sshObj.msg.send(response);
    }
  },
  onEnd:               function( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nSession text for " + sshObj.server.host + ":\n" + sessionText);
  }
}

//secondary host
var server2 = {
  server:              {
    host:         process.env.SERVER2_HOST,
    port:         process.env.SERVER2_PORT,
    userName:     process.env.SERVER2_USER_NAME,
    password:     process.env.SERVER2_PASSWORD,
    passPhrase:   process.env.SERVER2_PASS_PHRASE,
    privateKey:   ''
  },
  hosts:               [],
  commands:            [
    "msg:connected to host: passed",
    "sudo su",
    "cd ~/",
    "ll"
  ],
  msg:                 msg,
  verbose:             true,
  connectedMessage:    "",
  readyMessage:        "",
  closedMessage:       "",
  onCommandProcessing: function( command, response, sshObj, stream ) {
    //nothing to do here
  },
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if (command == "sudo su"){      
      sshObj.msg.send("Just ran a sudo su command");
    }
  },
  onEnd:               function( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nSession text for " + sshObj.server.host + ":\n" + sessionText);
  }
}


//primary host
var server1 = {
  server:              {
    host:         process.env.SERVER1_HOST,
    port:         process.env.SERVER1_PORT,
    userName:     process.env.SERVER1_USER_NAME,
    password:     process.env.SERVER1_PASSWORD,
    passPhrase:   process.env.SERVER1_PASS_PHRASE,
    privateKey:   require('fs').readFileSync(process.env.SERVER1_PRIV_KEY_PATH)
  },
  hosts:               [ server2, server3 ],
  commands:            [
    "msg:connected to host: passed",
    "ll"
  ],
  msg:                 msg,
  verbose:             true,
  connectedMessage:    "Connected to Staging",
  readyMessage:        "Running commands Now",
  closedMessage:       "Completed",
  onCommandProcessing: function( command, response, sshObj, stream ) {
    //nothing to do here
  },
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if (command == "ll"){      
      sshObj.msg.send(response);
    }
  },
  onEnd:               function( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nSession text for " + sshObj.server.host + ":\n" + sessionText);
  }
}

//until npm published use the cloned dir path.
var SSH2Shell = require ('ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(server1);
SSH.connect();
 
```

