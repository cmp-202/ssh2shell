var dotenv = require('dotenv').config();

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
 debug = false,
 verbose = false

//Host objects:
var host1 = {
  server:       conParamsHost1,
  commands:     [],
  connectedMessage: "Connected to host1",
  debug: debug,
  verbose: verbose
},

host2 = {
  server:       conParamsHost2,
  commands:     [ "echo host2" ],
  connectedMessage: "Connected to host2",
  debug: debug,
  verbose: verbose
},

host3 = {
  server:       conParamsHost3,
  commands:     [ "echo host3" ],
  connectedMessage: "Connected to host3",
  debug: debug,
  verbose: verbose
}

//host2.hosts = [ host3 ];
//Set the two hosts you are tunnelling to through host1
host1.hosts = [ host2, host3  ];

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


