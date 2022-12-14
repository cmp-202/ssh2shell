var dotenv = require('dotenv').config(),
	debug = false,
    verbose = false,
    util = require('util');

var host = {
  server: {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands: 	  ["echo chaining test success"],
  debug: debug,
  verbose: verbose
};

var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session

var SSH = new SSH2Shell(host)

var SSHconnect = util.promisify(SSH.connect)
SSHconnect()
  .then(( sessionText ) => {
     console.log ( sessionText);})
  .catch((error) => {
     console.log (error);
  });