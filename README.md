ssh2shell
=========
[![NPM](https://nodei.co/npm/ssh2shell.png?downloads=true&stars=true)](https://nodei.co/npm/ssh2shell/)

Ssh2shell uses [ssh2](https://www.npmjs.org/package/ssh2) to open a ssh shell session to a host/s to run multiple commands and process the responses.

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
  password:     "password",
 },
 commands:      [ "echo $(pwd)", "ls -l" ]
};

var SSH2Shell = require ('ssh2shell'),
  SSH = new SSH2Shell(host),  
  callback = function(sessionText){
    console.log(sessionText)
  }

//Start the process
SSH.connect(callback);
``` 


Host Configuration:
------------
SSH2Shell requires an object with the following structure:
```javascript
//Host cobfiguration
host = {
  server:              { 
    //host connection settings
    host:         "192.168.0.2",
    port:         "22", //optional
    userName:     "username",
    //optional or required settings subject to authentication method
    password:     "password",
    passPhrase:   "privateKeyPassphrase",
    privateKey:   require('fs').readFileSync('/path/to/private/key/id_rsa'),
    //Optional: ssh2.connect options
    //See https://github.com/mscdex/ssh2#client-methods
    
    //Optional: ssh options only for making secondary host ssh connections.
    //see http://man.openbsd.org/ssh for definitions of options.
    ssh: { //Options }
  },
  //Optional: Array of host objects for multiple host connections
  hosts:              [],
  
  //Optional: Characters used in prompt detection
  //defaults
  standardPrompt:     ">$%#",
  passwordPrompt:     ":",
  passphrasePrompt:   ":",
  passPromptText:     "Password",
  
  //Optional: exclude or include host banner after connection
  showBanner:         false,
  //https://github.com/mscdex/ssh2#pseudo-tty-settings
  window:             false, 
  
  //Optional: Enter key character to send as end of line.
  enter:              "\n",
  
  //Optional: stream encoding
  streamEncoding:     "utf8",
  
  //Optional: Regular expressions to simplify response
  //defaults:
  asciiFilter:        "[^\r\n\x20-\x7e]", //removes non-standard ASCII
  disableColorFilter:  false, //turns colour filtering on and off
  textColorFilter:    "(\[{1}[0-9;]+m{1})", //removes colour formatting codes
  
  //Required: array of commands
  commands:           ["cd /var/logs", "ls -al"],
  
  //Optional: Used by this.emit("msg", "my message")
  msg:                function( message ) {
      console.log(message);
    }
  }, 
  
  //Optional: Trouble shooting options
  verbose:             false,  //outputs all received content
  debug:               false,  //outputs information about each process step
  
  //Optional: Command time-out to stop a command hanging and not returning to a command prompt
  idleTimeOut:         5000,  //integer
  
  //Optional: timeout interval when waiting for a host response. 
  dataIdleTimeOut:     500,  //integer
  
  //Optional: Messages returned on each connection event.
  //default:
  connectedMessage:    "Connected",
  readyMessage:        "Ready",
  closedMessage:       "Closed",
  
  //Optional: Host event handlers .
  //Host defined event handlers are set as the default event handlers.
  
  //Optional: 
  onKeyboardInteractive: function(name, instructions, instructionsLang, prompts, finish){
    //See https://github.com/mscdex/ssh2#client-events    
  },
  
  //Optional:
  onData: function( data ) {
    //data is the raw response from the host
  },
  
  //Optional: 
  onPipe: function( stream ) {
    //a read stream that will receive raw resonse data
  },
  
  //Optional: 
  onUnpipe: function( steam ) {
    //removes the steam added in onPipe.
  },
  
  //Optional: 
  onCommandProcessing: function( command, response, sshObj, stream ) {
   //Event rasised when data is received from the host before the command prompt is detected.
   //command: is the last command run.
   //response: is the buffer that is being loaded with each data event.
   //sshObj: is the current host object.
   //stream: gives stream.write() access if a response is required outside the normal command flow.
  },
  
  //Optional: 
  onCommandComplete:   function( command, response, sshObj ) {
   //Event raised when a standard prompt is detected after a command is run.
   //response: is the full response from the host for the last command.
   //sshObj: is the current host object.
  },
  
  //Optional: 
  onCommandTimeout:    function( command, response, stream, connection ) {
   //Event is raised when a standard prompt is not detected and no data is 
   //received from the host within the host.idleTimeout value.
   //command: is the last command run or "" when first connected.
   //response: is the text received up to the time out.
   //stream: gives stream.write() access if a response is required outside the normal command flow.
   //connection: gives access to close the connection if all else fails
   //The timer can be reset from within this event in case a stream write gets no response.
  },
  
  //Optional: 
  onEnd:               function( sessionText, sshObj ) {
   //is raised when the stream.on ("finish") event is triggered
   //SessionText is the full text for this hosts session   
   //sshObj is the host object
  },
    
  //Optional: 
  onError:            function( err, type, close = false, callback ) {
   //Run when an error event is raised.
   //err: is either an Error object or a string containing the error message
   //type: is a string containing the error type
   //close: is a Boolean value indicating if the connection should be closed or not
   //callback: is the function to run when handling the error defined as function(err,type){}
   //if using this remember to handle closing the connection based on the close parameter.
   //To close the connection us this.connection.close()
  },
  
  //Optional:
  callback:           function( sessionText ){
    //sessionText: is the full session response
    //Is overridden by SSH2shell.connect(callback)
  }  
};
```
* Host.server will accept current [SSH2.client.connect parameters](https://github.com/mscdex/ssh2#client-methods).
* Optional host properties or event handlers do not need to be included if you are not changing them.
* Host event handlers completely replace the default event handler definitions in the class when defined.
* `this.sshObj` or sshObj variable passed into a function provides access to all the host config, some instance
  variables and the current array of commands for the host. The sshObj.commands array changes with each host connection.


ssh2shell API
-------------
SSH2Shell extends events.EventEmitter

*Methods*

* .connect(callback(sessionText)) Is the main function to establish the connection and handle data events from the server. 
  It takes in an optional callback function for processing the full session text.

* .emit("eventName", function, parms,... ). Raises the event based on the name in the first string and takes input
  parameters based on the handler function definition.
  
* .pipe(stream) binds a writable stream to the output of the read stream but only after the connection is established.

* .unpipe(stream) removes a piped stream but can only be called after a connection has been made.

*Variables*

* .sshObj is the host object as defined above along with some instance variables.

* .command is the current command being run until a new prompt is detected and the next command replaces it.


Usage:
======
Connecting to a single host:
----------------------------


*app.js*
```javascript
var host = {
 server:        {
   host:         "192.168.0.1",
   userName:     "myuser",
   passPhrase:   "myPassPhrase",
   privateKey:   require('fs').readFileSync("~/.ssh/id_rsa")
 },
 commands:      [
  "`This is a message that will be added to the full sessionText`",
  "msg:This is a message that will be displayed during the process",
  "cd ~/",
  "ls -l"
 ]
};

var SSH2Shell = require ('ssh2shell'),
    SSH       = new SSH2Shell(host);

var callback = function (sessionText){
        console.log (sessionText);
    }
    
SSH.connect(callback);
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
* When host.debug is set to true each process step raises a msg event to help identify what the internal processes were.

__*Note:*
Do not add debug or verbose to the onCommandProccessing event which is called every time a response is received from the host.__

Add your own verbose messages as follows:
`if(this.sshObj.verbose){this.emit("msg", this.sshObj.server.host + ": response: " + response);} //response might need to be changed to this._buffer`

Add your own debug messages as follows:
`if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": eventName");} //where eventName is the text identifying what happened`

Notification commands:
----------------------
There are two notification commands that are added to the host.commands array but are not run as a command on the host.

1. `"msg:This is a message"`. outputs to the console.
2. "\`SessionText notification\`" will take the text between "\` \`" and add it to the sessionText only.
 * The reason for not using echo or printf commands as a normal command is that you see both the command and the message in the sessionText which is pointless when all you want is the message.


Sudo and su Commands:
--------------
It is possible to use `sudo [command]`, `sudo su`, `su [username]` and `sudo -u [username] -i`. 
Sudo commands uses the password for the current session and is processed by ssh2shell. Su on the other hand uses the password
of root or an other user (`su seconduser`) and requires you detect the password prompt in `host.onCommandProcessing` and run `this.runCommand(password)`.

See: [su VS sudo su VS sudo -u -i](http://johnkpaul.tumblr.com/post/19841381351/su-vs-sudo-su-vs-sudo-u-i) for
     clarification about the difference between the commands.

See: [test/sudosutest.js](https://github.com/cmp-202/ssh2shell/blob/master/test/sudosutest.js) for a working code example.


Prompt detection override:
-------------------------
Used to detect different prompts. 

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
 
Defaults:
```javascript
host.asciiFilter = "[^\r\n\x20-\x7e]"
host.disableColorFilter = false //or true
host.textColorFilter = "(\[{1}[0-9;]+m{1})"
 ```

 
Responding to non-standard command prompts:
----------------------
In host.onCommandProcessing event handler the prompt can be detected and a response can be sent via `stream.write("y\n")`.

`host.onCommandProcessing` definition replaces the default handler and runs only for the current host connection
```javascript
host.onCommandProcessing = function( command, response, sshObj, stream ) {
   //Check the command and prompt exits and respond with a 'y' but only does it once
   if (command == "apt-get install nano" && response.indexOf("[y/N]?") != -1 && sshObj.firstRun != true) {
     //This debug message will only run when conditions are met not on every data event so is ok here
     sshObj.firstRun = true
     stream.write('y\n');
   }
 };
\\sshObj.firstRun could be reset to false in host.onCommandComplete to allow for detect another non-standard prompt 
```

Instance definition that runs in parallel with every other commandProcessing for every host connection
To handle all hosts the same add an event handler to the class instance
Don't define an event handler in the host object with the same code, it will do it twice!
```javascript
var SSH2Shell = require ('ssh2shell');
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
If no prompt is detected `commandTimeout` will be raised after the idleTimeOut period.__


Command Time-out event
---------------
When onCommandTimeout event triggers after the host.idleTimeOut is exceeded. 
This is because there is no new data and no prompt is detected to run the next command.
It is recommended to close the connection as a default action if all else fails so you are not left with a hanging script. 
The default action is to add the last response text to the session text and disconnect. 
Enabling host.debug would also provide the process path leading up to disconnection which in conjunction with
the session text would clarify what command and output triggered the timeout event.

**Note: If you receive garble back before the clear response you may need to save the previous response text to the 
  sessionText and clear the buffer before using stream.write() in commandTimeout. 
  `this.sshObj.sessionText = response` and `this._buffer = ""`**


```javascript
host.onCommandTimeout = function( command, response, stream, connection ) {
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
```

or 

```javascript
//reset the default handler to do nothing so it doesn't close the connection
host.onCommandTimeout = function( command, response, stream, connection ) {};

//Create the new instance
var SSH2Shell = require ('ssh2shell'),
    SSH       = new SSH2Shell(host)

//And do it all in the instance event handler
SSH.on ('commandTimeout',function( command, response, stream, connection ){
  //first test should only pass once to stop a response loop
  if (command === "atp-get install node" 
     && response.indexOf("[Y/n]?") != -1 
     && this.sshObj.nodePrompt != true) {
    this.sshObj.nodePrompt = true;
    stream.write('y\n');
    
    return true;
  }
  this.sshObj.sessionText += response;
  //emit an error that closes the connection
  this.emit("error", this.sshObj.server.host + ": Command \`" + command + "\` timed out after " 
    + (this._idleTime / 1000) + " seconds. command: " + command, "Command Timeout", true);
});

SSH.on ('end', function( sessionText, sshObj ) {
  this.emit("msg","\nSession text for " + sshObj.server.host + ":\n" + sessionText);
 });
 
SSH.connect();
```


Tunnelling nested host objects:
---------------------------------
`hosts: [ host1, host2]` setting can make multiple host connections possible. 
Each host config object has its own server settings, commands, command handlers and
event handlers. Each host object also has its own hosts array that other host objects can be added to.
This provides for different host connection sequences to multiple depth of connections.

**SSH connections:**
Once the primary host connection is made all other connections are made using an ssh command from the 
current host to the next. A number of ssh command options are set using an optional `host.server.ssh` object. 
`host.server.ssh.options` allows setting any ssh config options. 

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
This example shows two hosts (server2, server3) that are connected to via server1. 
The two host configs are added to server1.hosts array.

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
2. Server1.hosts array is checked for other hosts.
3. Server1 is stored for use later and server2's host object is loaded as the current host.
4. A connection to the next host is made using its server parameters via running the ssh command in the current session.
5. That hosts commands are completed and it's hosts array is checked for other hosts.
6. If no hosts are found the connection is closed triggering an end event for the current host if defined.
5. Server1 host object is reloaded as the current host object and server2 host object discarded.
6. Server1.hosts array is checked for other hosts and the next host popped off the array.
7. Server1's host object is restored and the process repeats for an all other hosts.
8. Server1 is loaded for the last time and all hosts sessionText's are appended to `this.callback(sessionText)`.
10. As all sessions are closed, the process ends.


**_Note:_** 
* A host object needs to be defined before it is added to another host.hosts array.
* Only the primary host objects connected, ready and closed messages will be used by ssh2shell.
* Connection events only apply to the first host. Keyboard-interactive event handler is one of these.


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
  if (command == "ls -l"){      
    this.emit("msg", this.sshObj.server.host + ":\n" + response);
  }
}
  
//Add an on end event handler used by all hosts
SSH.on ('end', function( sessionText, sshObj ) {
  //show the full session output. This could be emailed or saved to a log file.  
  this.emit ("msg", "\nSessiontText -------------------------------------------------\n");
  this.emit ("msg", sshObj.server.host + ":\n" + sessionText);
  this.emit ("msg", "\nEnd sessiontText ---------------------------------------------\n");
});

//Start the process
SSH.connect();
 
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
 * Defining a host event handler replaces the default coded event handler.

2. Add an event handler, as defined below, to the class instance.
 * Handlers added to the class instance will be triggered every time the event is raised in parallel with any other
   handlers of the same name.
 * It will not replace the internal event handler of the class set by the class default or host definition.  

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
