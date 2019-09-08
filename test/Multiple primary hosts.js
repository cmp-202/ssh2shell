var dotenv = require('dotenv');
dotenv.load();

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
  commands:     [
    "echo Host_1"
  ],
  connectedMessage: "Connected to host1",
  debug: debug,
  verbose: verbose
},

host2 = {
  server:       conParamsHost2,
  commands:     [
    "echo Host_2"
  ],
  debug: debug,
  verbose: verbose
},

host3 = {
  server:       conParamsHost3,
  commands:     [
    "echo Host_3"
  ],
  debug: debug,
  verbose: verbose
},
host11 = {
  server:       conParamsHost1,
  commands:     [
    "echo Host_11"
  ],
  connectedMessage: "Connected to host1",
  debug: debug,
  verbose: verbose
},

host22 = {
  server:       conParamsHost2,
  commands:     [
    "echo Host_22"
  ],
  debug: debug,
  verbose: verbose
},

host33 = {
  server:       conParamsHost3,
  commands:     [
    "echo Host_33"
  ],
  debug: debug,
  verbose: verbose
},
hosts = []
host1.hosts =  [host33,host22]
host2.hosts =  [host11,host33]
host3.hosts =  [host22,host33]
hosts = [ host1, host2, host3 ]

//or the alternative nested tunnelling method outlined above:
//host2.hosts = [ host3 ];ssh -q george@192.168.0.129 "echo 2>&1" && echo OK || echo NOK
//host1.hosts = [ host2 ];

//Create the new instance
//or SSH2Shell = require ('ssh2shell')
var SSH2Shell = require ('../lib/ssh2shell'),
    SSH = new SSH2Shell(hosts),
    callback = function( sessionText ){
          console.log ( "-----Callback session text:\n" + sessionText);
          console.log ( "-----Callback end" );
    }


//Start the process
SSH.connect(callback);


