var dotenv = require('dotenv').config(),
    fs = require('fs')

var host = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  debug: false,
  commands:           [
    "msg: first",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "msg: 11",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "msg: 21",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update",
    "sudo apt-get -y update"
  ]
};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(host),
locLog = fs.createWriteStream('Lots of commands.log')

SSH.pipe( locLog );
SSH.connect();