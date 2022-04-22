var dotenv = require('dotenv').config()

var sshObj1 = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands: [
    "msg: using msg.send",
    "`All done!`",
  ],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },
  verbose: false,
  debug: false
};

var callback = function( sessionText, sshObj ){
       
    }
  
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj1);

var callback = function( sessionText, sshObj ){
          
     //show the full session output. This could be emailed or saved to a log file.
    this.emit("msg", "\nThis is the full session response: 2\n\n" + sessionText);
    sshObj1.msg = function( message ) {
      console.log(message);
    }
    sshObj1.commands = [
        "msg: using msg",
        "`All done!`",
      ]
    var SSH = new SSH2Shell(sshObj1);
    var callback = function( sessionText, sshObj ){
         //show the full session output. This could be emailed or saved to a log file.
        this.emit("msg", "\nThis is the full session response: 3\n\n" + sessionText);
        sshObj1.msg = undefined
        sshObj1.commands = [
            "msg: using default msg",
            "`All done!`",
          ]
        var SSH = new SSH2Shell(sshObj1);
        SSH.connect();
      }
    SSH.connect(callback);
  }
  
SSH.connect(callback);
