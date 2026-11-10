var dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('tunnel.js');

var conParamsHost1 = {
  host:         process.env.HOST,
  port:         process.env.PORT,
  userName:     process.env.USER_NAME,
  password:     process.env.PASSWORD
 },
 conParamsHost2 = {
  host:         process.env.SERVER2_HOST,
  port:         process.env.PORT,
  userName:     process.env.SERVER2_USER_NAME,
  password:     process.env.SERVER2_PASSWORD
 },
 //set to fail
 conParamsHost3 = {
  host:         process.env.SERVER3_HOST,
  port:         process.env.PORT,
  userName:     process.env.SERVER3_USER_NAME,
  password:     process.env.SERVER3_PASSWORD
 },
 debug = (process.env.DEBUG === "true"),
 verbose = (process.env.VERBOSE === "true")


//Host objects:
var host1 = {
  server:       conParamsHost1,
  commands:     [ "echo host1" ],
  connectedMessage: "Connected to host1",
  debug: debug,
  verbose: verbose,
  onCommandComplete: (command, response, sshObj) => {console.log(`${sshObj.server.host}: host1: onCommandComplete:`);}
},

host2 = {
  server:       conParamsHost2,
  commands:     [ "echo host2" ],
  connectedMessage: "Connected to host2",
  debug: debug,
  verbose: verbose,
  onCommandComplete: (command, response, sshObj) => {console.log(`${sshObj.server.host}:host2: onCommandComplete:`);}
},

host3 = {
  server:       conParamsHost3,
  commands:     [ "echo host3" ],
  connectedMessage: "Connected to host3",
  debug: debug,
  verbose: verbose,
  onCommandComplete: (command, response, sshObj) => {console.log(`${sshObj.server.host}:host3: onCommandComplete:`);}
}

//host2.hosts = [ host3 ];
//Set the two hosts you are tunnelling to through host1
host2.hosts = [ host3 ];
//host1.hosts = [ host2, host3 ];

//or the alternative nested tunnelling method outlined above:
//host2.hosts = [ host3 ];ssh -q george@192.168.0.129 "echo 2>&1" && echo OK || echo NOK
host1.hosts = [ host2 ];

//Create the new instance
//or SSH2Shell = require ('ssh2shell')
var SSH2Shell = require ('../src/ssh2shell'),

SSH = new SSH2Shell(host1),
callback = function( sessionText ){
  log ( "-----Callback session text:\n" + sessionText);
  log ( "-----Callback end" );
}
SSH.on('msg', log); 
SSH.idleTime = 1500;
//Start the process
SSH.connect(callback);


