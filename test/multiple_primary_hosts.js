var dotenv = require('dotenv').config(),
  debug = false,
  verbose = false 
 

//Host objects:
var host1 = {
  server: {
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands:     ["echo Host_1"],
  connectedMessage: "Connected to host1",
  debug: debug,
  verbose: verbose
},

host2 = {
  server: {
    host:         process.env.SERVER2_HOST,
    port:         process.env.PORT,
    userName:     process.env.SERVER2_USER_NAME,
    password:     process.env.SERVER2_PASSWORD
  },
  commands:     ["echo Host_2"],
  connectedMessage: "Connected to host2",
  debug: debug,
  verbose: verbose
},

host3 = {
  server: {
    host:         process.env.SERVER3_HOST,
    port:         process.env.PORT,
    userName:     process.env.SERVER3_USER_NAME,
    password:     process.env.SERVER3_PASSWORD
  },
  commands:     ["echo Host_3"],
  connectedMessage: "Connected to host3",
  debug: debug,
  verbose: verbose,
  //Event handler only used by this host
  onCommandComplete: function( command, response, sshObj ) {
    this.emit("msg", sshObj.server.host + ": commandComplete only used on this host");
  }
}


var SSH2Shell = require ('../lib/ssh2shell'),
    SSH = new SSH2Shell([host1,host2,host3]),
    callback = function( sessionText ){
          console.log ( "-----Callback session text:\n" + sessionText);
          console.log ( "-----Callback end" );
    }


SSH.on ('end', function( sessionText, sshObj ) {
    this.emit("msg", sshObj.server.host + ": onEnd every host");
  })
SSH.connect(callback);


