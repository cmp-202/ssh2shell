ssh2shell
======================

Wrapper class for [ssh2](https://github.com/mscdex/ssh2) shell command.

*This class enables the following functionality:*
* Run multiple commands sequentially within the context of the previous commands result.
* Sudo and sudo su handling.
* Ability to respond to prompts resulting from a command as it is being run.
* Ability to check the current command and conditions within the response text before the next command is run.
* Performing actions based on command/response tests like adding or removing commands, sending notifications or processing of command response text.
* See progress messages: either static (on events) or dynamic in the callback functions.
* Use full session response text in the onEnd callback function triggered when the connection is closed.
* Run commands that are processed as notification messages to either the full session text or a message handler function and not run in the shell.
* Create bash scripts on the fly, run them and then remove them.
* SSH tunnelling to another host using key or password authentication on either host.
* Use different passwords for primary and secondary hosts when authenticating.

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
sshObj = {
  server:             {       
    host:         "[IP Address]",
    port:         "[external port number]",
    userName:     "[user name]",
    password:     "[user password]",
    sudoPassword: "[optional: different sudo password or blank if the same as password]",
    passPhrase:   "[private key passphrase or ""]",
    privateKey:   [require('fs').readFileSync('/path/to/private/key/id_rsa') or ""]
  },
  commands:           ["Array", "of", "command", "strings"],
  msg:                {
    send: function( message ) {
      [message handler code]
    }
  }, 
  verbose:            true/false, 
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
cp .env-example .env

//change .env values to valid host settings then run
node test/devtest.js
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
SUDO_PASSWORD=
PRIV_KEY_PATH=~/.ssh/id_rsa
PASS_PHRASE=myPassPhrase
```

*app.js*
```
var dotenv = require('dotenv');
dotenv.load();

var sshObj = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD,
    sudoPassword: process.env.SUDO_PASSWORD,
    passPhrase:   process.env.PASS_PHRASE,
    privateKey:   require('fs').readFileSync(process.env.PRIV_KEY_PATH)
  },
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
var SSH = new SSH2Shell(sshObj);
SSH.connect();

```

Authentication:
---------------
* To use password authentication set sshObj.server.privateKey to "".
* When using key authentication you may require a valid passphrase if your key was created with one. If not set sshObj.server.passPhrase to ""
* If you are tunnelling to a second host but the usernames and passwords between the two are different you will need to set sshObj.server.password to the password of the first host and sshObj.server.sudoPassword for the second. (See **Tunnelling through another host:** below for password authentication and other requirements.)

**Trouble shooting:**

* `Error: Unable to parse private key while generating public key (expected sequence)` is caused by the passphrase being incorrect. This confused me because it doesn't indicate the passphrase was the problem but it does indicate that it could not decrypt the private key. 
 * Recheck your passphrase for typos or missing chars.
 * Try connecting manually to the host using the exact passhrase used by the code to confirm it works.
 * I did read of people having problems with the the passphrase or password having an \n added when used from an external file causing it to fail. They had to add .trim() when setting it.
* If your user password is incorrect the process will stall on sudo due to it presenting the password prompt a second time which the code doesn't currently handle (on my todo list). Using verbose set to true may show this is happening or it will show that no commands were run after a sudo or sudo su which should indicate it is the likely problem. 

Sudo Commands:
--------------
The code detects if a sudo command is used and will look for a password prompt if it has not already responsed with a password previously. If sshObj.server.sudoPassword is set then it will use that value in all cases or will drop back to use sshObj.server.password if it isn't. (see *Tunnelling through another host*, especially the detail on which host you can run sudo commands on if passwords differ.) 
If sudo su is deteccted an extra exit command will be added to close the session correctly once all commands are complete.

Notification commands:
----------------------
There are two notification commands that can be added to the command array but are not processed in the shell.

1. "msg:This is a message intended for monitoring the process as it runs" The text after `msg:` is outputted throught whatever method the msg.send function uses. It might be to the console or a chat room or a log file but is considered direct response back to whatever or whoever is watching the process to notify them of what is happening.
2. "\`SessionText notification\`" will add the message between the \` to the sessionText variable that contains all of the session responses and is passed to the onEnd callback function. The reason for not using echo or printf commands is that you see both the command and the message in the sessionTest result which is pointless when all you want is the message.

Verbose:
--------
When verbose is set to true each command response is passed to the msg.send function when the command completes.

**Note:**
There are times when an unexpected prompt occurs leaving the session waiting for a response it will never get if it is not handled and so you will never see the final full sessionText because the onEnd callback will never be called. 
Rerunning the commands with verbose set to true will show you where the process failed and enable you to add extra handling in the onCommandProcessing callback to resolve the problem.

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
You can echo/printf the script content into a file as a command, ensure it is executible, run it and then delete it.
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

Tunnelling through another host:
---------------------------------
One thing this functionality provides is another method to SSH tunnel through one host to another host.
It might be that a production server doesn't have SSH access exposed on a public interface but a staging server on the same network does.
In this case you can SSH into the staging server and then SSH to the production server to say run deployment commands or restart services.

*There are some conditions that need to be handled:* 

1. When you ssh to a new host through a primary host you are likely to encounter a prompt to add the key for the new host which will stall the process without extra handling. 
*Options:*
  * Set ssh to not even ask in the first place by adding -oStrictHostKeyChecking=no to the ssh command. (see: [auto accept host keys](http://xmodulo.com/2013/05/how-to-accept-ssh-host-keys-automatically-on-linux.html)).
  * Detect the ssh command and prompt then respond. See **Responding to command prompts** method outlined above and customise your own solution.
2. If the primary host and secondary host user passwords are not the same then the sshObj.server.sudoPassword needs to be set. This enables the primary host to be authenticated using the sshObj.server.password but the secondary host to use a different password for sudo. In this case sudo commands can only be used on the secondary host because it will never use sshObj.server.password which is the password for the primary host.
3. Password authentication would work on the first host but won't be handled correctly on the second host automatically.
*Options:*
  * Using key authentication would resolve this by registering the primary host user public key in the .ssh/autherized\_keys file of the secondary host so no password is ever requested. Manually run `ssh-copy-id -i ~/.ssh/id_rsa.pub username@remote-host` and enter the password for the remote-host when prompted. [Keys tutorial](http://www.thegeekstuff.com/2008/11/3-steps-to-perform-ssh-login-without-password-using-ssh-keygen-ssh-copy-id/)
  * It would be possible to use the onCommandProcessing callback to detect the ssh command and password prompt then respond with the required password if key authentication is not an option. `if ( command.indexOf('ssh') != -1 && response.match(/[:]\s$/)) {stream.write(sshObj.server.password+'\n');}` or use the sudoPassword if the passwords differ `{stream.write(sshObj.server.sudoPassword+'\n');}`
4. An exit command needs to be added as your last command to close both ssh sessions correctly. 
5. It might be worth checking if the second connection failed, empty the commands array so the session closes and send a message with the failure response.

**Tunnelling Example:**

```
var sshObj = {
  server:             {     
    host:       "192.168.0.100",
    port:       "22",
    userName:   "firstuser",
    password:   "primaryPassword",
    sudoPassword: "secondaryPassword",
    passPhrase: "",
    privateKey: ""
  },
  commands:           [
    "echo $(pwd)",
    "msg:Connecting to second host",
    "ssh -oStrictHostKeyChecking=no seconduser@10.0.0.20",
    "`Connected to second host`",
    "echo $(pwd)",
    "sudo su",
    "cd ~/",
    "ll",
    "echo $(pwd)",
    "ll",
    "`Add an exit command to close the session on both hosts correctly`",
    "exit"
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
   //secondary host password authentication
   if ( command.indexOf('ssh') != -1 && response.match(/[:]\s$/)) {
    stream.write(sshObj.server.sudoPassword+'\n');
   }
  },
  onCommandComplete:  function( command, response, sshObj ) {
   //confirm it is the root home dir and change to root's .ssh folder
   if (command == "echo $(pwd)" && response.indexOf("/root") != -1 ) {
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
var SSH = new SSH2Shell(sshObj);
SSH.connect(); 
```

