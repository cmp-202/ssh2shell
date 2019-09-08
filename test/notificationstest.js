var dotenv = require('dotenv');
dotenv.load();

var sshObj = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands: [
    "ls -l",
    "`All done!`",
  ],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },
  verbose: false,
  debug: false,
  onEnd: function( sessionText, sshObj ){
     //show the full session output. This could be emailed or saved to a log file.
    this.emit("msg", "\nThis is the full session response:\n\n" + sessionText);
  }
};

//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj);

SSH.connect();