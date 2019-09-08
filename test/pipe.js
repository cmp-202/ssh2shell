var dotenv = require('dotenv'),
    fs = require('fs')
	fs = require('fs')
dotenv.load()

var host = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD,
  },
  commands:           [
    "echo host pipe"
  ],
   debug: true
}
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell')

//run the commands in the shell session
var SSH = new SSH2Shell(host),
    callback = function( sessionText ){
          console.log ( "-----Callback session text:\n" + sessionText);
          console.log ( "-----Callback end" );
      },
    firstLog = fs.createWriteStream('first.log'),
    secondLog = fs.createWriteStream('second.log')

SSH.pipe(firstLog)  
SSH.pipe(secondLog)
SSH.connect(callback)