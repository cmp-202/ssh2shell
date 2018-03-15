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
  debug:          true,
  verbose:        false
};
var host2 = {commands: ["cd ~"]}
var host3 = {commands: ["ls"]}
Object.assign(host2,host)
Object.assign(host3,host)
host.commands = ["ls -la"]
//var SSH2Shell = require ('ssh2shell');
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell([host,host2,host3]),
    callback = function( sessionText ){
          console.log ( "-----Callback session text:\n" + sessionText);
          console.log ( "-----Callback end" );
      }

SSH.connect(callback)