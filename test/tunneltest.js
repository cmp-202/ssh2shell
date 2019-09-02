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
 //set to fail
 conParamsHost3 = {
  host:         process.env.SERVER3_HOST,
  port:         process.env.PORT,
  userName:     process.env.SERVER3_USER_NAME,
  password:     process.env.SERVER3_PASSWORD
 },
 debug = true,
 verbose = false

//Host objects:
var host1 = {
  server:       conParamsHost1,
  commands:     [
    "msg:connected to host1",
    "cd ~",
    "ls -la"
  ],
  connectedMessage: "Connected to host1",
  debug: debug,
  verbose: verbose
},

host2 = {
  server:       conParamsHost2,
  commands:     [
    "msg:connected to host2",
    "cd ~/",
    "ls -la"
  ],
  debug: debug,
  verbose: verbose
},

host3 = {
  server:       conParamsHost3,
  commands:     [
    "msg:connected to host3",
    "cd ~/",
    "ls -la"
  ],
  debug: debug,
  verbose: verbose
}

host2.hosts = [ host3 ];
//Set the two hosts you are tunnelling to through host1
host1.hosts = [ host2 ];

//or the alternative nested tunnelling method outlined above:
//host2.hosts = [ host3 ];ssh -q george@192.168.0.129 "echo 2>&1" && echo OK || echo NOK
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


