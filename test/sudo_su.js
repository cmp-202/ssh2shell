var dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('sudo_su.js');

var host = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands:           [
    "msg:Showing current directory",
    "echo \$(pwd)",
    "ls -al",
    "sudo -i",
    "msg:Showing root home directory",
    "cd \~",
    "echo \$(pwd)",
    "ls -al",
    "msg:exiting root",
    "exit",
    "msg:Changing to " + process.env.secondaryUser + " via su [username]",
    "su " + process.env.secondaryUser,
    "msg:Showing user home directory",
    "cd \~",
    "echo \$(pwd)",
    "ls -al",
    "msg:exiting user ",
    "exit",
    "msg:Changing user via sudo -u [username] -i",
    "sudo -u " + process.env.USER_NAME + " -i",
    "msg:Showing user directory",
    "cd \~",
    "echo \$(pwd)",
    "ls -la"
  ],  
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
  suPassSent:         false, //used by commandProcessing to only send password once
  rootPassSent:       false,
  onCommandProcessing: function( command, response, sshObj, stream ) {
    if (command === "su " + process.env.secondaryUser && response.indexOf("Password: ") != -1 && sshObj.suPassSent != true) {
      sshObj.commands.unshift("msg:Using secondary user password");
      //this is required to stop "bounce" without this the password would be sent multiple times
      sshObj.suPassSent = true;
      stream.write(process.env.secondUserPassword + "\n");
    }
  }
};
var SSH2Shell = require ('../src/ssh2shell');

var SSH = new SSH2Shell(host),
    callback = function( session ){
        const sessionText = (`-----Callback session text:\n${session}\n-----Callback end`);
        log ( sessionText );
        console.log(sessionText);
    }      
    SSH.on('msg', log); 
    SSH.connect(callback);
