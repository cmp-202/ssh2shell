var dotenv = require('dotenv');
dotenv.load();

var conParamsHost1 = {
  host:         process.env.SERVER1_HOST,
  port:         process.env.PORT,
  userName:     process.env.SERVER1_USER_NAME,
  password:     process.env.SERVER1_PASSWORD
 },
 conParamsHost2 = {
  host:         process.env.SERVER2_HOST,
  port:         process.env.PORT,
  userName:     process.env.SERVER2_USER_NAME,
  password:     process.env.SERVER2_PASSWORD
 },
 conParamsHost3 = {
  host:         process.env.SERVER3_HOST,
  port:         process.env.PORT,
  userName:     process.env.SERVER3_USER_NAME,
  password:     process.env.SERVER3_PASSWORD
 }

//Host objects:
var host1 = {
  server:              conParamsHost1,
  commands:            [
    "msg:connected to host1: passed",
    "ls -la"
  ],
  connectedMessage:    "Connected to Primary host1",
  onCommandComplete:   function( command, response, sshObj) {
    //we are listing the dir so output it to the msg handler
    if (command === "ls -l"){      
      this.emit("msg", response);
    }
  }
},

host2 = {
  server:              conParamsHost2,
  commands:            [
    "msg:connected to host2: passed",
    "sudo su",
    "cd ~/",
    "ls -la"
  ],
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if (command === "sudo su"){      
      this.emit("msg", "Just ran a sudo su command");
    }
  },
  onEnd: function( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    this.emit("msg", "\nSession text for " + sshObj.server.host + ":\n" + sessionText + "\nThe End\n");
  }
},

host3 = {
  server:              conParamsHost3,
  commands:            [
    "msg:connected to host: passed",
    "sudo su",
    "cd ~/",
    "ls -la"
  ],
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    this.emit("msg", response)
  }
}

//Set the two hosts you are tunnelling to through host1
host1.hosts = [ host2, host3 ];

//or the alternative nested tunnelling method outlined above:
//host2.hosts = [ host3 ];
//host1.hosts = [ host2 ];

//Create the new instance
//or SSH2Shell = require ('ssh2shell')
var SSH2Shell = require ('../lib/ssh2shell'),
    SSH = new SSH2Shell(host1),
    callback = function( sessionText ){
          console.log ( "-----Callback session text:\n" + sessionText);
          console.log ( "-----Callback end" );
      }


//Start the process
SSH.connect(callback);
