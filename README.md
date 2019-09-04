ssh2shell
=========
[![NPM](https://nodei.co/npm/ssh2shell.png?downloads=true&stars=true)](https://nodei.co/npm/ssh2shell/)

Wrapper class for [ssh2](https://www.npmjs.org/package/ssh2) shell command.

*ssh2shell supports the following functionality:*
* SSH shell connection to one or more hosts.
* Run multiple commands sequentially within the context of the previous commands result.
* SSH tunnelling to multiple hosts using nested host objects.
* When tunnelling each host has its own connection parameters, commands, command handlers,
  event handlers and debug or verbose settings.
* Supports `sudo`, `sudo su` and `su user` commands.
* Supports changing default prompt matching regular expressions for different prompt requirements
* Ability to respond to prompts resulting from a command as it is being run.
* Ability to check the last command and conditions within the response text before the 
  next command is run.
* Performing actions based on a command run and the response received. 
  Things like adding or removing commands, responding using stream.write() or processing the command response text.
* See progress messages, messages you define, error messages and debug messages of script process 
  or verbose output of responses from the host.
* Access to full session response text in the end event triggered when each host connection is closed.
* Run notification commands that are processed either as messages to the full session text only or 
  messages outputted to your console only.
* Add event handlers either to the class instance or define them within host object.
* Create bash scripts on the fly, run them and remove them.
* Server SSH fingerprint validation.
* Access to [SSH2.connect parameters](https://github.com/mscdex/ssh2#client-methods) for first host connection.
* Keyboard-interactive authentication.
* Pipe stream.data into another writeable stream using SSH2shell.pipe(writableStream). Pipe commands can be chained.
* Also process raw stream.data through SSH2shell.on('data') or host.onData event handlers as the stream receives each
  character. 
* Use a callback function to handle final session text. The callback function can be defined in the host object or 
  passed to SSH2shell.connect(callback). The callback function has access to the `this` keyword. 


Code:
-----
The Class is written in coffee script which can be found here: `./src/ssh2shell.coffee`. 
It has comments not found in the build output JavaScript file `./lib/ssh2shell.js`.
 
 
Installation:
------------
```
npm install ssh2shell
```


Minimal Example:
------------
```javascript
//host configuration with connection settings and commands
var host = {
 server:        {     
  host:         "127.0.0.1",
  userName:     "test",
  password:     "1234",
 },
 commands:      [ "echo $(pwd)", "ls -l" ]
};

var SSH2Shell = require ('ssh2shell'),
  //Create a new instance passing in the host object
  SSH = new SSH2Shell(host),
  //Use a callback function to process the full session text
  callback = function(sessionText){
    console.log(sessionText)
  }

//Start the process
SSH.connect(callback);
``` 

Host Configuration:
------------
SSH2Shell expects an object with the following structure to be passed to its constructor:
```javascript
//Host object
host = {
  server:              { 
    //required connection settings
    host:         "IP Address",
    port:         "external port number",
    userName:     "user name",
    //optional or required settings subject to authentication method used
    password:     "user password",
    passPhrase:   "privateKeyPassphrase",
    privateKey:   require('fs').readFileSync('/path/to/private/key/id_rsa'),
    //Optional: ssh2.connect config parameters
    //See https://github.com/mscdex/ssh2#client-methods
    //ssh2.connect parameters are only valid for the first host connection.
    //Other host connections use the ssh command/s to connect not ssh2.
    
    //Optional: ssh options only for making secondary host ssh connections when tunnelling:
    //see http://man.openbsd.org/ssh for definitions of options below.
    ssh: {
        //Optional
        forceProtocolVersion: true/false,
        forceAddressType: true/false,
        disablePseudoTTY: true/false,
        forcePseudoTTY: true/false,
        verbose: true/false,
        cipherSpec: "",
        escape: "",
        logFile: "",
        configFile: "",
        identityFile: "",
        loginName: "",
        macSpec: "",
        Options: {}
    }
  },
  //Optional: Array of host objects for multiple host connections
  hosts:              [host2, host3, host4, host5],
  
  //Optional: Characters used in prompt detection
  standardPrompt:     ">$%#",
  passwordPrompt:     ":",
  passphrasePrompt:   ":",
  passPromptText:     "Password",
  
  //Optional: exclude or include host banner after connection and window size 
  showBanner:         false,
  window:             false, //https://github.com/mscdex/ssh2#pseudo-tty-settings use {cols:200}
  
  //Optional: Enter key character to send as end of line.
  enter:              "\n", //Linux = "\n" | "\x0a\, Mac = "\r" | "x0d"
  
  //Optional: stream encoding
  streamEncoding:     "utf8",
  
  //Optional: Regular expressions to clean output text
  asciiFilter:        "[^\r\n\x20-\x7e]", //removes non-standard ASCII
  disableColorFilter:  false, //turns colour filtering on and off
  textColorFilter:    "(\[{1}[0-9;]+m{1})", //removes colour formatting codes
  
  //Required: array of commands
  commands:           ["cd /var/logs", "ls -al", "msg:Listed dir", "cd /home/user"],
  
  //Optional: Used by this.emit("msg", "my message") to output a message
  msg:                {
    send: function( message ) {
      console.log(message);
    }
  }, 
  
  //Optional: Trouble shooting options
  verbose:             false,  //outputs all received content
  debug:               false,  //outputs information about each process step
  
  //Optional: Command time-out timer max interval in milliseconds
  idleTimeOut:         5000,  //integer
  
  //Optional: timeout between data events. max interval in milliseconds
  dataIdleTimeOut:     500,  //integer
  
  //Optional: Messages returned on each connection event.
  connectedMessage:    "Connected",
  readyMessage:        "Ready",
  closedMessage:       "Closed",
  
  //Optional: Host event handlers 
  //These event handlers only apply to the host object they are defined within.
  //Host event function definitions replace the default event handlers defined 
  //in the class instead of adding another handler to the listeners.
  //`this.` is correctly linked to the instance within host defined event handlers.
  
  //Optional: Keyboard interactive authentication event handler
  //This event is only used for the first host connecting through ssh2.connect
  //Required if the first host.server.tryKeyboard is set to true. 
  onKeyboardInteractive: function(name, instructions, instructionsLang, prompts, finish){
    //See https://github.com/mscdex/ssh2#client-events
    //name, instructions, instructionsLang don't seem to be of interest for authenticating
    //prompts is an object of expected prompts and if they are to be shown to the user
    //finish is the function to be called with an array of responses in the same order as 
    //the prompts parameter defined them.
    //See [Client events](https://github.com/mscdex/ssh2#client-events) for more information
    //if a non-standard prompt results from a successful connection then handle its 
    //detection and response in onCommandProcessing or commandTimeout.
    //see text/keyboard-interactivetest.js
  },
  
  //Optional: data is triggered on every stream data event providing the raw stream output 
  //without SSH2shell interacting with it.
  onData: function( data ) {
    //data is a string chunk received from the connected host
  },
  
  //Optional: The pipe event is raised when readStream.pipe() adds a writeable stream to 
  //receive output
  onPipe: function( source ) {
    //source is the read stream the write stream will receive output from
  }
  
  //Optional: The unpipe event is raised when readStream.unpipe() removes a writeable stream 
  //so it no longer receives output
  onUnpipe: function( source ) {
    //source is the read stream to remove from being able to write its output.
  },
  
  //Optional: Command processing is triggered on every data read event (one character at a time) 
  //until prompt is detected.
  onCommandProcessing: function( command, response, sshObj, stream ) {
   //command is the last command run. This is "" just after connection before the first prompt
   //response is the buffer that is being loaded with each data event not the char received.
   //sshObj is the current host object.
   //stream gives stream.write() access if a response is required outside the normal command flow.
  },
  
  //Optional: Command complete is raised when a standard prompt is detected.
  onCommandComplete:   function( command, response, sshObj ) {
   //response is the full response from the host for the last command
   //sshObj is the current host object.
  },
  
  //Optional: Command timeout is raised when a standard prompt is not detected and no data is 
  //received from the host after host.idleTimeout value.
  //This stops the connection from hanging when no prompt is detected usually because the
  // host is requiring a response it will never get. This event 
  onCommandTimeout:    function( command, response, stream, connection ) {
   //command is the last command run or "" if no prompt after connection
   //response is the text received up to the time out.
   //stream object is used to send text to the host without having to close the connection.
   //connection gives access to close the connection if all else fails
   //The connection will hang if you send text to the host but get no response and you don't
   //close the connection. 
   //The timer can be reset from within this event in case a stream write gets no response.
   //See test/timeouttest.js for and example of multiple commandTimeout triggers.
  },
  
  //Recommended: The end event is raised when the stream.on ("finish") event is triggered as the 
  //connection is closed or when any nested host connection is closed. 
  //This is where you handle the full session text for a host connection.
  //When connecting to multiple hosts the primary host end event receives the full concatenated 
  //session text for all hosts, including its own, to process.
  onEnd:               function( sessionText, sshObj ) {
   //SessionText is the full text for this hosts session   
   //sshObj is the host object
  },
    
  //Optional: Run when an error event is raised be it connection or otherwise.
  onError:            function( err, type, close = false, callback ) {
   //err is either an Error object or a string containing the error message
   //type is a string containing the error type
   //close is a Boolean value indicating if the connection should be closed or not
   //callback is the function to run with handling the error in the form of function(err,type)
   //if overwriting the default definition remember to handle closing the connection based on close
   //To close the connection us this.connection.close()
  },
  
  //Optional: callback function definition called when the stream closes
  callback:           function( sessionText ){
    //sessionText is the full session response filtered and notifications added
    //Is overridden by SSH2shell.connect(callback)
  }  
};
```
* Host.server will accept current [SSH2.client.connect parameters](https://github.com/mscdex/ssh2#client-methods).
* Optional host properties or event handlers do not need to be included if you are not changing them.
* See the end of the readme for event handlers available to be added to the instance listeners.
* Host event handlers completely replace the default event handler definitions in the class when defined.
* The instance `this` keyword is available within host event handlers to give access to ssh2shell object api like
  this.emit() and other functions.
* `this.sshObj` or sshObj variable passed into a function provides access to all the host config, some instance
  variables and the current array of commands for the host. The sshObj.commands array changes with host connection.


ssh2shell API
-------------
SSH2Shell extends events.EventEmitter

*Methods*

* .connect(callback(sessionText)) Is the main function to establish the connection and handle data events from the server which triggers
  the rest of the process. It take in an optional callback function that receives the full session text as its parameter.

* .emit("eventName", function, parms,... ). Raises the event based on the name in the first string and takes input
  parameters based on the handler function definition.
  
* .pipe(destination) binds a writable stream to the output of the read stream but only after the connection is established.

* .unpipe(destination) removes piped streams but can only be called after a connection has been made.

*Variables*

* .sshObj is the host object as defined above along with some instance variables.

* .command is the current command being run until a new prompt is detected and the next command replaces it.


Test Files:
-----
```javascript
//single host test
cp .env-example .env
//set the env variables to match your test host/vm username and password.
node text/simple.js

//simple pipe example
node test/pipe.js

//multiple nested hosts
//requires the additional details added to .env file for each server
//my tests were done using three VM hosts
node test/tunneltest.js

//test the command idle time out timer and provide an example of a more complicated timeout handler
node test/timeouttest.js

//Test multiple sudo and su combinations for changing user
//Issue #10
//Also test promt detection with no password requested 
//Issue #14
node test/sudosutest.js

//Test using notification commands as the last command
//Issue #11
node test/notificationstest.js

//Test keyboard-interactive authentication on the host that has it enabled 
node test/keyboard-interactivetest.js
```


Usage:
======
Connecting to a single host:
----------------------------

*How to:*
* Use an .env file for server values loaded by dotenv from the root of the project.
* Connect using a key pair with pass phrase.
* Use sudo su with user password.
* Set commands.
* Test the response of a command and add more commands and notifications in the host.onCommandComplete event handler.
* Use the two notification types in the commands array.
* Use msg: notifications to track progress in the console as the process completes.
* Email the final full session text to yourself.

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
 
 onCommandComplete: function( command, response, sshObj ) {
  //confirm it is the root home dir and change to root's .ssh folder
  if(sshObj.debug){
    this.emit("msg", this.sshObj.server.host + ": host.onCommandComplete event, command: " + command);
  }
  if (command === "echo $(pwd)" && response.indexOf("/root") != -1 ) {
   //unshift will add the command as the next command, use push to add command as the last command
   sshObj.commands.unshift("msg:The command and response check worked. Added another cd command.");
   sshObj.commands.unshift("cd .ssh");
  }
  //we are listing the dir so output it to the msg handler
  else if (command === "ls -l"){      
   this.emit("msg", response);
  }
 },
 
 onEnd: function( sessionText, sshObj ) {
  //email the session text instead of outputting it to the console
  if(sshObj.debug){this.emit("msg", this.sshObj.server.host + ": host.onEnd event");}
  var sessionEmail = new Email({ 
    from: "me@example.com", 
    to:   "me@example.com", 
    subject: "Automated SSH Session Response",
    body: "\nThis is the full session responses for " + sshObj.server.host + ":\n\n" + sessionText
  });
  this.emit("msg", "Sending session response email");
  
  // if callback is provided, errors will be passed into it
  // else errors will be thrown
  sessionEmail.send(function(err){ sshObj.msg.send('error', err, 'Email'); });
 }
};


//Create a new instance
var SSH2Shell = require ('ssh2shell'),
    SSH       = new SSH2Shell(host);

//Start the process
SSH.connect();

or
//use a callback
var callback = function (sessionText){
        console.log (sessionText);
    }
SSH.connect(callback);
```

Tunnelling nested host objects:
---------------------------------
SSH tunnelling has been incorporated into core of the class process enabling nested host objects.
The new `hosts: [ host1, host2]` setting can make multiple host connections possible. 
Each host config object has its own server settings, commands, command handlers and
event handlers. Each host object also has its own hosts array that other host objects can be added to.
This provides for different host connection sequences to any depth of recursion.

**SSH connections:**
Once the primary host connection is made all other connections are made using an ssh command from the 
current host to the next. I have given access to a number of ssh command options by adding
an optional host.server.ssh object. All host.server.ssh properties are optional. 
host.server.ssh.options allows setting any ssh config option from the command. 

```
var host = {
    server: { ...,
        ssh: {
            forceProtocolVersion: true/false,
            forceAddressType: true/false,
            disablePseudoTTY: true/false,
            forcePseudoTTY: true/false,
            verbose: true/false,
            cipherSpec: "",
            escape: "",
            logFile: "",
            configFile: "",
            identityFile: "",
            loginName: "",
            macSpec: "",
            options: {}
        }
    }
}
```


**Tunnelling Example:**
This example shows two hosts (server2, server3) that are connected to via server1. The two host configs are add
to server1.hosts array.

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
4. A connection to server2 is made using its server parameters via running the ssh command on the primary.
5. Server2's commands are completed and server2.hosts array is checked for other hosts.
6. With no hosts found the connection to server2 is closed triggering an end event (calling server2.onEnd function if defined).
5. Server1 host object is reloaded as the current host object and server2 host object discarded.
6. Server1.hosts array is checked for other hosts and the next host popped off the array.
7. Server1's host object is stored again and server3's host object is loaded as the current host.
8. Server3 is connected to and it completes its process.
9. Server3.hosts is checked and with no hosts found the connection is closed and the end event is triggered.
9. Server1 is loaded for the last time.
10. The session text for each connection is appended to the session text for the primary host.
11. With no further hosts to load the connection is closed triggering an end event for the last time.
12. As all sessions are closed the process ends.


**_Note:_** 
* A host object needs to be defined before it is added to another host.hosts array.
* Only the primary host objects connected, ready and closed messages will be used by ssh2shell.
* Connection events only apply to the primary host. Keyboard-interactive event handler is one of these.


*How to:*
* Define nested hosts
* Use unique host connection settings for each host
* Defining different commands and command event handlers for each host
* Sharing duplicate functions between host objects
* What host object attributes you can leave out of primary and secondary host objects
* Unique event handlers set in host objects, common event handler set on class instance

**_Note:_** 
* Change debug to true to see the full process for each host.

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
  password:     process.env.SERVER2_PASSWORD
 },
 conParamsHost3 = {
  host:         process.env.SERVER3_HOST,
  port:         process.env.SERVER3_PORT,
  userName:     process.env.SERVER3_USER_NAME,
  password:     process.env.SERVER3_PASSWORD
 }
 

//Host objects:
var host1 = {
  server:              conParamsHost1,
  commands:            [
    "msg:connected to host: passed. Listing dir.",
    "ls -l"
  ],
  debug: false,
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if(sshObj.debug){
      this.emit("msg", this.sshObj.server.host + ": host.onCommandComplete host1, command: " + command);
    }
  },
  onEnd:    function( sessionText, sshObj ) {
    //show the full session output for all hosts.
    if(sshObj.debug){this.emit("msg", this.sshObj.server.host + ": primary host.onEnd all sessiontText");}  
    this.emit ("msg", "\nAll Hosts SessiontText ---------------------------------------\n");
    this.emit ("msg", sshObj.server.host + ":\n" + sessionText);
    this.emit ("msg", "\nEnd sessiontText ---------------------------------------------\n");
  })
},

host2 = {
  server:              conParamsHost2,
  commands:            [
    "msg:connected to host: passed",
    "msg:Changing to root dir",
    "cd ~/",
    "msg:Listing dir",
    "ls -l"
  ],
  debug: false,
  connectedMessage:    "Connected to host2",
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if(sshObj.debug){
      this.emit("msg", this.sshObj.server.host + ": host.onCommandComplete host2, command: " + command);
    }
    if (command.indexOf("cd") != -1){  
      this.emit("msg", this.sshObj.server.host + ": Just ran a cd command:\n");    
      this.emit("msg", response);
    }
  }
},

host3 = {
  server:              conParamsHost3,
  commands:            [
    "msg:connected to host: passed",
    "hostname"
  ],
  debug: false,
  connectedMessage:    "Connected to host3",
  onCommandComplete:   function( command, response, sshObj) {
    //we are listing the dir so output it to the msg handler
    if(sshObj.debug){
      this.emit("msg", this.sshObj.server.host + ": host.onCommandComplete host3, command: " + command);
    }
    if (command.indexOf("cd") != -1){  
      this.emit("msg", this.sshObj.server.host + ": Just ran hostname command:\n");    
      this.emit("msg", response);
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

//Add a commandComplete handler used by all hosts 
SSH.on ('commandComplete', function onCommandComplete( command, response, sshObj ) {
  //we are listing the dir so output it to the msg handler
  if(sshObj.debug){
    this.emit("msg", this.sshObj.server.host + ": instance.onCommandComplete, command: " + command);
  }
  if (command == "ls -l"){      
    this.emit("msg", this.sshObj.server.host + ":\n" + response);
  }
}
  
//Add an on end event handler used by all hosts
SSH.on ('end', function( sessionText, sshObj ) {
  //show the full session output. This could be emailed or saved to a log file.
  if(sshObj.debug){this.emit("msg", this.sshObj.server.host + ": instanse.onEnd all hosts");}
  
  this.emit ("msg", "\nSessiontText -------------------------------------------------\n");
  this.emit ("msg", sshObj.server.host + ":\n" + sessionText);
  this.emit ("msg", "\nEnd sessiontText ---------------------------------------------\n");
});

//Start the process
SSH.connect();
 
```


Trouble shooting:
-----------------

* Adding msg command `"msg:Doing something"` to your commands array at key points will help you track the sequence of
  what has been done as the process runs. (See examples)
* `Error: Unable to parse private key while generating public key (expected sequence)` is caused by the pass phrase
  being incorrect. This confused me because it doesn't indicate the pass phrase was the problem but it does indicate
  that it could not decrypt the private key. 
 * Recheck your pass phrase for typos or missing chars.
 * Try connecting manually to the host using the exact pass phrase used by the code to confirm it works.
 * I did read of people having problems with the pass phrase or password having an \n added when used from an
   external file causing it to fail. They had to add .trim() when setting it.
* If your password is incorrect the connection will return an error.
* There is an optional debug setting in the host object that will output process information when set to true and
  passwords for failed authentication of sudo commands and tunnelling. `host.debug = true`
* The class now has an idle time out timer (default:5000ms) to stop unexpected command prompts from causing the process
  hang without error. The default time out can be changed by setting the host.idleTimeOut with a value in milliseconds.
  (1000 = 1 sec)


Verbose and Debug:
------------------
* When host.verbose is set to true each command complete raises a msg event outputting the response text.
* When host.debug is set to true each process step raises a msg event to help identify what the internal process of
  each step was.

__*Note:*
Do not add these to the commandProccessing event which is called every time a character is received from the host__

Add your own verbose messages as follows:
`if(this.sshObj.verbose){this.emit("msg", this.sshObj.server.host + ": response: " + response);}` //response might need
to be changed to this._buffer

Add your own debug messages as follows:
`if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": eventName");}` //where eventName is the text
identifying what happened


Command Time-out Event Handler
---------------
When the program doesn't detect a standard prompt and doesn't receive any more data the onCommandTimeout event triggers
after the host.idleTimeOut value (in ms). This is usually because an unexpected prompt on the server is requiring a 
response that isn't handled or the host is not responding at all. In either case detection of the standard prompt will
never happen causing the program to hang, perpetually waiting for a response it won’t get. The commandTimeout stops this.
The commandTimeout event can enable you to handle such prompts without having to disconnect by providing the response
the host requires. The host then replies with more text triggering a data received event resetting the timer and
enabling the process to continue. It is recommended to close the connection as a default action if all else fails so you
are not left with a hanging script again. The default action is to add the last response text to the session text and
disconnect. Enabling host.debug would also provide the process path leading up to disconnection which in conjunction with
the session text would clarify what command and output triggered the event.

**Note: If you receive garble back before the clear response you may need to save the previous response text to the 
  sessionText and clear the buffer before using stream.write() in commandTimeout. 
  `this.sshObj.sessionText = response` and `this._buffer = ""`**


```javascript
host.onCommandTimeout = function( command, response, stream, connection ) {
   if(sshObj.debug){this.emit("msg", this.sshObj.server.host + ": host.onCommandTimeout");}
   if (command === "atp-get install node" 
       && response.indexOf("[Y/n]?") != -1 
       && this.sshObj.nodePrompt != true) {
     //Setting this.sshObj.nodePrompt stops a response loop
     this.sshObj.nodePrompt = true
     stream.write('y\n')
   }else{
     //emit an error that passes true for the close parameter and callback that loads the last response
     //into sessionText
     this.emit ("error", this.sshObj.server.host 
       + ": Command timed out after #{this._idleTime/1000} seconds. command: " 
       + command, "Timeout", true, function(err, type){
         this.sshObj.sessionText += response
       })
   }
}

or 

host.onCommandTimeout = function( command, response, stream, connection ) {
   if(sshObj.debug){this.emit("msg", this.sshObj.server.host + ": host.onCommandTimeout");}
   if (command === "" && response === "Connected to port 22" && this.sshObj.noFirstPrompt != true) {
     //Setting this.sshObj.noFirstPrompt stops a response loop
     this.sshObj.noFirstPrompt = true
     stream.write('\n')
     return true
   }
   //emit an error that passes true for the close parameter and callback the loads the last of session text
   this.emit ("error", this.sshObj.server.host 
     + ": Command timed out after #{this._idleTime/1000} seconds. command: "
     + command, "Timeout", true, function(err, type){
       this.sshObj.sessionText += response
     })
}

or 

//reset the default handler to do nothing so it doesn't close the connection
host.onCommandTimeout = function( command, response, stream, connection ) {};

//Create the new instance
var SSH2Shell = require ('ssh2shell'),
    SSH       = new SSH2Shell(host)

//And do it all in the instance event handler
SSH.on ('commandTimeout',function( command, response, stream, connection ){
  if(sshObj.debug){this.emit("msg", this.sshObj.server.host + ": instance.onCommandTimeout");}
  //first test should only pass once to stop a response loop
  if (command === "atp-get install node" 
     && response.indexOf("[Y/n]?") != -1 
     && this.sshObj.nodePrompt != true) {
    this.sshObj.nodePrompt = true;
    stream.write('y\n');
    return true;
  }
  this.sshObj.sessionText += response;
  this.emit("error", this.sshObj.server.host + ": Command \`" + command + "\` timed out after " 
    + (this._idleTime / 1000) + " seconds. command: " + command, "Command Timeout", true);
});

SSH.on ('end', function( sessionText, sshObj ) {
  //show the full session output. This could be emailed or saved to a log file.
  if(sshObj.debug){this.emit("msg", this.sshObj.server.host + ": instance.onEnd");}
  this.emit("msg","\nSession text for " + sshObj.server.host + ":\n" + sessionText);
 });
 
SSH.connect();
```

Authentication:
---------------
* Each host authenticates with its own host.server parameters.
* When using key authentication you may require a valid pass phrase if your key was created with one.
* When using fingerprint validation both host.server.hashMethod property and host.server.hostVerifier function must be
  set.
* When using keyboard-interactive authentication both host.server.tryKeyboard and instance.on ("keayboard-interactive",
  function...) or host.onKeyboardInteractive() must be defined.
* Set the default cyphers and keys.

Default Cyphers:
---------------
Default Cyphers and Keys used in the initial ssh connection can be redefined by setting the ssh2.connect.algorithms through the host.server.algorithms option. 
As with this property all ssh2.connect properties are set in the host.server object.

*Example:*
```javascript
var host = {
    server:        {  
            host:           "<host IP>",
            port:           "22",
            userName:       "<username>",
            password:       "<password>",
            hashMethod:     "md5", //optional "md5" or "sha1" default is "md5"
            //other ssh2.connect options
            algorithms: {
                kex: [
                    'diffie-hellman-group1-sha1',
                    'ecdh-sha2-nistp256',
                    'ecdh-sha2-nistp384',
                    'ecdh-sha2-nistp521',
                    'diffie-hellman-group-exchange-sha256',
                    'diffie-hellman-group14-sha1'],
                cipher: [
                    'aes128-ctr',
                    'aes192-ctr',
                    'aes256-ctr',
                    'aes128-gcm',
                    'aes128-gcm@openssh.com',
                    'aes256-gcm',
                    'aes256-gcm@openssh.com',
                    'aes256-cbc'
                ]
            }

        },
    ......
}
```

Fingerprint Validation:
---------------
At connection time the hash of the server’s public key can be compared with the hash the client had previously recorded
for that server. This stops "man in the middle" attacks where you are redirected to a different server as you connect
to the server you expected to. This hash only changes with a reinstall of SSH, a key change on the server or a load
balancer is now in place. 

__*Note:*
 Fingerprint check doesn't work the same way for tunnelling. The first host will validate using this method but the
 subsequent connections would have to be handled by your commands. Only the first host uses the SSH2 connection method
 that does the validation.__

To use fingerprint validation you first need the server hash string which can be obtained using ssh2shell as follows:
* Set host.verbose to true then set host.server.hashKey to any non-empty string (say "1234"). 
 * Validation will be checked and fail causing the connection to terminate. 
 * A verbose message will return both the server hash and client hash values that failed comparison. 
 * This is also what will happen if your hash fails the comparison with the server in the normal verification process.
* Turn on verbose in the host object, run your script with hashKey unset and check the very start of the text returned
  for the servers hash value. 
 * The servers hash value can be saved to a variable outside the host or class so you can access it without having to
   parse response text.

*Example:*
```javascript
//Define the hostValidation function in the host.server config.
//hashKey needs to be defined at the top level if you want to access the server hash at run time
var serverHash, host;
//don't set expectedHash if you want to know the server hash
var expectedHash
expectedHash = "85:19:8a:fb:60:4b:94:13:5c:ea:fe:3b:99:c7:a5:4e";

host = {
    server: {
        //other normal connection params,
        hashMethod:   "md5", //"md5" or "sha1"
        //hostVerifier function must be defined and return true for match of false for failure.
        hostVerifier: function(hashedKey) {
            var recievedHash;
            
            expectedHash = expectedHash + "".replace(/[:]/g, "").toLowerCase();
            recievedHash = hashedKey + "".replace(/[:]/g, "").toLowerCase();
            if (expectedHash === "") {
              //No expected hash so save save what was received from the host (hashedKey)
              //serverHash needs to be defined before host object
              serverHash = hashedKey; 
              console.log("Server hash: " + serverHash);
              return true;
            } else if (recievedHash === expectedHash) {
              console.log("Hash values matched");
              return true;
            }
            //Output the failed comparison to the console if you want to see what went wrong
            console.log("Hash values: Server = " + recievedHash + " <> Client = " + expectedHash);
            return false;
          },
    },
    //Other settings
};

var SSH2Shell = require ('ssh2shell'),
    SSH       = new SSH2Shell(host);
SSH.connect();
```
__*Note:* 
host.server.hashMethod only supports md5 or sha1 according to the current SSH2 documentation anything else may produce
undesired results.__


Keyboard-interactive
----------------------
Keyboard-interactive authentication is available when both host.server.tryKeyboard is set to true and the event handler
keyboard-interactive is defined as below. The keyboard-interactive event handler can only be used on the first connection.

Also see [test/keyboard-interactivetest.js](https://github.com/cmp-202/ssh2shell/blob/master/test/keyboard-interactivetest.js) for the full example 

*Defining the event handler:*
```javascript
//this is required
host.server.tryKeyboard = true;

var SSH2Shell = require ('../lib/ssh2shell');
var SSH = new SSH2Shell(host);
  
//Add the keyboard-interactive handler
//The event function must call finish() with an array of responses in the same order as prompts received
// in the prompts array
SSH.on ('keyboard-interactive', function(name, instructions, instructionsLang, prompts, finish){
     if (this.sshObj.debug) {this.emit('msg', this.sshObj.server.host + ": Keyboard-interactive");}
     if (this.sshObj.verbose){
       this.emit('msg', "name: " + name);
       this.emit('msg', "instructions: " + instructions);
       var str = JSON.stringify(prompts, null, 4);
       this.emit('msg', "Prompts object: " + str);
     }
     //The example presumes only the password is required
     finish([this.sshObj.server.password] );
  });
  
SSH.connect();
```

Or

```javascript
host = {
    ...,
    onKeyboardInteractive: function(name, instructions, instructionsLang, prompts, finish){
      if (this.sshObj.debug) {this.emit('msg', this.sshObj.server.host + ": Keyboard-interactive");}
      if (this.sshObj.verbose){
      this.emit('msg', "name: " + name);
      this.emit('msg', "instructions: " + instructions);
      var str = JSON.stringify(prompts, null, 4);
      this.emit('msg', "Prompts object: " + str);
      }
      //The example presumes only the password is required
      finish([this.sshObj.server.password] );
    },
    ...
}
```

Sudo and su Commands:
--------------
It is possible to use `sudo [command]`, `sudo su`, `su [username]` and `sudo -u [username] -i`. Sudo commands uses the
password for the user that is accessing the server and is handled by SSH2shell. Su on the other hand uses the password
of root or the other user (`su seconduser`) and requires you detect the password prompt in onCommandProcessing.

See: [su VS sudo su VS sudo -u -i](http://johnkpaul.tumblr.com/post/19841381351/su-vs-sudo-su-vs-sudo-u-i) for
     clarification about the difference between the commands.

See: [test/sudosutest.js](https://github.com/cmp-202/ssh2shell/blob/master/test/sudosutest.js) for a working code example.


Notification commands:
----------------------
There are two notification commands that are added to the host.commands array but are not run as a command on the host.

1. `"msg:This is a message intended for monitoring the process as it runs"`. The `msg:` command raises a onMsg(message)
   event. 
 * The text after `msg:` is passed to the message property of the onMsg event.
2. "\`SessionText notification\`" will take the text between "\` \`" and add it to the sessionText.
 * The reason for not using echo or printf commands as a normal command is that you see both the command and the message
   in the sessionText which is pointless when all you want is the message.


Prompt detection override:
-------------------------
The following properties have been added to the host object making it possible to override prompt string values used
with regular expressions to for prompt detection. Being able to change these values enables you to easily manage all
sorts of prompt options subject to you server prompts. 

These are optional settings.
``` 
  host.standardPrompt =   ">$%#";
  host.passwordPrompt =   ":";
  host.passphrasePrompt = ":";
 ``` 
 
 
Text regular expression filters:
-------------------------------
There are two regular expression filters that remove unwanted text from response data.
 
The first removes non-standard ascii and the second removes ANSI text formatting codes. Both of these can be modified in
your host object to override defaults. It is also possible to output the ANSI codes by setting disableColorFilter to true.
 
These are optional settings
```javascript
host.asciiFilter = "[^\r\n\x20-\x7e]"
host.disableColorFilter = false //or true
host.textColorFilter = "(\[{1}[0-9;]+m{1})"
 ```

 
Responding to non-standard command prompts:
----------------------
When running commands there are cases that you might need to respond to specific prompt that results from the command
being run. The command response check method is the same as in the example for the host.onCommandComplete event handler
but in this case we use it in the host.onCommandProcessing event handler. The stream object is available in
onCommandProcessing to the prompt directly using strea.write("y\n"), note "\n" might be required to complete the
response. 

Host definition that replaces the default handler and runs only for the current host connection
```javascript
host.onCommandProcessing = function( command, response, sshObj, stream ) {
   //Check the command and prompt exits and respond with a 'y' but only does it once
   if (command == "apt-get install nano" && response.indexOf("[y/N]?") != -1 && sshObj.firstRun != true) {
     //This debug message will only run when conditions are met not on every data event so is ok here
     if (sshObj.debug) {this.emit('msg', this.sshObj.server.host + ": Responding to nano install");}
     sshObj.firstRun = true
     stream.write('y\n');
   }
 };
\\sshObj.firstRun can be reset to false in onCommandComplete to allow for another non-standard prompt 
```

Instance definition that runs in parallel with every other commandProcessing for every host connection
```javascript
//To handle all hosts the same add an event handler to the class instance
//Don't define an event handler in the host object with the same code, it will do it twice!
var SSH2Shell = require ('../lib/ssh2shell');
var SSH = new SSH2Shell(host);

SSH.on ('commandProcessing', function onCommandProcessing( command, response, sshObj, stream ) {

   //Check the command and prompt exits and respond with a 'y'
   if (command == "apt-get install nano" && response.indexOf("[y/N]?") != -1 && sshObj.firstRun != true ) {
     //This debug message will only run when conditions are met not on every data event so is ok here
     if (sshObj.debug) {this.emit('msg', this.sshObj.server.host + ": Responding to nano install");}
     sshObj.firstRun = true
     stream.write('y\n');
   }
};
```

__*Note:*
If there is no response from the server the commandTimeout will be triggered after the idleTimeOut period.__

Bash scripts on the fly:
------------------------
If the commands you need to run would be better suited to a bash script as part of the process it is possible to generate
or get the script on the fly. You can echo/printf the script content into a file as a command, ensure it is executable, 
run it and then delete it. The other option is to curl or wget the script from a remote location but
this has some risks associated with it. I like to know what is in the script I am running.

**Note** # and > in the following commands with conflict with the host.standardPrompt definition ">$%#" change it to "$%"

```
 host.commands = [ "some commands here",
  "if [ ! -f myscript.sh ]; then printf '#!/bin/bash\n" +
  " #\n" +
  "  current=$(pwd);\n" +
 "cd ..;\n" +
 "if [ -f myfile ]; then" +
  "sed \"/^[ \\t]*$/d\" ${current}/myfile | while read line; do\n" +
    "printf \"Doing some stuff\";\n" +
    "printf $line;\n" +
  "done\n" +
 "fi\n' > myscript.sh;" + 
"fi",
  "sudo chmod 700 myscript.sh",
  "./myscript.sh",
  "rm myscript.sh"
 ],
```


Event Handlers:
---------------
There are a number of event handlers that enable you to add your own code to be run when those events are triggered. 
Most of these you have already encountered in the host object. You do not have to add event handlers unless you want
to add your own functionality as the class already has default handlers defined. 

There are two ways to add event handlers:

1. Add handler functions to the host object (See requirements at start of readme). 
 * These event handlers will only be run for the currently connected host.Important to understand in a multi host setup. 
 * Within the host event functions `this` is always referencing the ssh2shell instance at run time. 
 * Instance variables and functions are available through `this` including the Emitter functions like 
   this.emit("myEvent", properties).
 * Connect, ready, error and close events are not available for definition in the host object.
 * Defining a host event replaces the default event handler. Again while that host is connected.

2. Add an event handler, as defined below, to the class instance.
 * Handlers added to the class instance will be triggered every time the event is raised in parallel with any other
   handlers of the same name.
 * It will not replace the internal event handler of the class be it set by the class default or a host definition.  

An event can be raised using `this.emit('eventName', parameters)`.

*Further reading:* 
[node.js event emitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)

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
 //message is the text to output.
});

ssh2shell.on ("commandProcessing", function onCommandProcessing( command, response, sshObj, stream )  {
 //Allows for the handling of a commands response as each character is loaded into the buffer 
 //default: no action
 //default is replaced by host.onCommandProcessing function if defined 
 //command is the command that is being processed
 //response is the text buffer that is being loaded with each data event from stream.ready
 //sshObj is the host object
 //stream is the connection stream
});
    
ssh2shell.on ("commandComplete", function onCommandComplete( command, response, sshObj ) {
 //Allows for the handling of a commands response before the next command is run 
 //default: returns a debug message if host.debug = true
 //default is replaced by host.onCommandComplete function if defined
 //command is the completed command
 //response is the full buffer response from the command
 //sshObj is the host object
});
    
ssh2shell.on ("commandTimeout", function onCommandTimeout( command, response, stream ,connection ) {
 //Allows for handling a command timeout that would normally cause the script to hang in a wait state
 //default: an error is raised adding response to this.sshObj.sessionText and the connection is closed
 //default is replaced by host.onCommandTimeout function if defined
 //command is the command that timed out
 //response is the text buffer up to the time out period
 //stream is the session stream
 //connection is the main connection object
});

ssh2shell.on ("end", function onEnd( sessionText, sshObj ) {
 //Allows access to sessionText when stream.finish triggers 
 //default: returns a debug message if host.debug = true
 //default is replaced by host.onEnd function if defined 
 //sessionText is the full text response from the session
 //sshObj is the host object
});

ssh2shell.on ("close", function onClose(had_error = void(0)) { 
 //default: outputs primaryHost.closeMessage or error if one was received
 //default: returns a debug message if host.debug = true
 //had_error indicates an error was received on close
});

ssh2shell.on ("error", function onError(err, type, close = false, callback(err, type) = undefined) {
 //default: raises a msg with the error message, runs the callback if defined and closes the connection
 //default is replaced by host.onEnd function if defined 
 //err is the error received it maybe an Error object or a string containing the error message.
 //type is a string identifying the source of the error
 //close is a Boolean value indicating if the event should close the connection.
 //callback a function that will be run by the handler
});

ssh2shell.on ("keyboard-interactive", 
  function onKeyboardInteractive(name, instructions, instructionsLang, prompts, finish){
 //See https://github.com/mscdex/ssh2#client-events
 //name, instructions, instructionsLang don't seem to be of interest for authenticating
 //prompts is an object of expected prompts and if they are to be shown to the user
 //finish is the function to be called with an array of responses in the same order as 
 //the prompts parameter defined them.
 //See [Client events](https://github.com/mscdex/ssh2#client-events) for more information
 //if a non standard prompt results from a successful connection then handle its detection and response in
 //onCommandProcessing or commandTimeout.
 //see text/keyboard-interactivetest.js
});

ssh2shell.on ("data", function onData(data){
  //data is a string chunk received from the stream.data event
});

ssh2shell.on ("pipe", function onPipe(source){
  //Source is the read stream to output data from
});

ssh2shell.on ("Unpipe", function onUnpipe(source){
  //Source is the read stream to remove from outputting data
});
```
