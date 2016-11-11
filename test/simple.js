var dotenv = require('dotenv'),
    fs = require('fs')
dotenv.load();

var host = {
  server: {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  debug:          false,
  verbose:        false,
  commands:       [
    "`Test session text message: passed`",
    "msg:console test notification: passed",
    "ls -la"
  ],

};

//var SSH2Shell = require ('ssh2shell');
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(host),
    callback = function( sessionText ){
          console.log ( "-----Callback session text:\n" + sessionText);
          console.log ( "-----Callback end" );
      }

SSH.connect(callback)