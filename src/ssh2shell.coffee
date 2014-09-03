#================================
#  SSH2Shel
#================================
# Description
# SSH2 wrapper for creating a SSH shell connection and running multiple commands sequentially.
# The following object is required by the SSH2Shell class:
#
# sshObj = {
#   server:              {       
#     host:        "[IP Address]",
#     port:        "[external port number]",
#     userName:    "[user name]",
#     password:    "[user password]",
#     sudoPassword "[optional: different sudo password or blank if the same as password]",
#     passPhrase:  "[private key passphrase or ""]",
#     privateKey:  "[require('fs').readFileSync('/path/to/private/key/id_rsa') or ""]"
#   },
#   commands:            [Array of command strings],
#   msg:                 {
#     send: function( message ) {
#       [message handler code]
#     }
#   }, 
#   verbose:             true/false, #determines if all command output is processed by message handler as it runs]
#   connectedMessage:    "[on Connected message]",
#   readyMessage:        "[on Ready message]",
#   closedMessage:         "[on End message]",
#   onCommandProcessing: function( command, response, sshObj, stream ) {
#     [callback function, optional code to run during the procesing of a command]
#   },
#   onCommandComplete:   function( command, response, sshObj ) {
#     [callback function, optional code to run on the completion of a command]
#   },
#   onEnd:               function( sessionText, sshObj ) {
#     [callback function, optional code to run at the end of the session]
#   }
# }
#================================

class SSH2Shell
  sshObj:        {}
  stream:        {}
  sessionText:   ""
  command:       ""
  response:      ""
  _data:         ""
  _buffer:       ""
  _pwSent:       false
  _sudosu:       false
  _exit:         false
  
  _processData: ->
    #remove non-standard ascii from terminal responses
    @_data = @_data.replace(/[^\r\n\x20-\x7e]/g, "")
    #remove other weird nonstandard char representation from responses like [32m[31m
    @_data = @_data.replace(/(\[[0-9]?[0-9]m)/g, "")
    @_buffer += "#{@_data}"
    #check if password is needed
    if @command.indexOf("sudo") isnt -1 
      @_processPasswordPrompt()
    #Command prompt so run the next command
    else if @_buffer.match(/[#$]\s$/)
      @_processNextCommand
    else
      @sshObj.onCommandProcessing @command, @_buffer, @sshObj, @stream

  _processPasswordPrompt: =>
    #when the buffer is fully loaded the prompt can be detected
    if @_pwSent is false
      if @_buffer.match(/password.*:\s$/i)
        @_buffer = ""
        #check sudo su has been used and not just sudo for adding an extra exit command later
        if @command.indexOf("sudo su") isnt -1
          @_sudosu = true
        #set the pwsent flag and send the password for sudo
        @_pwSent = true
        password = @sshObj.server.sudoPassword ? @sshObj.server.password
        @stream.write "#{password}\n"
    #handle if password sent    
    else
      #reprompted for password indicating failed password 
      if @_buffer.match(/password.*:\s$/i)
        @sshObj.msg.send "Error: Sudo password was incorrect session is closing"
        if @sshObj.verbose
          password = @sshObj.server.sudoPassword ? @sshObj.server.password
          @sshObj.msg.send "password: #{password}"
        #add buffer to sessionText so the sudo response can be seen
        @sessionText += "#{@_buffer}"
        #empty commands to stop any more being run
        @sshObj.commands = []
        #if sudo su then reverse the sudosu flag as no extra exit command required
        if @command.indexOf("sudo su") isnt -1
          @_sudosu = false
        #exit the session
        @_runExit()
      #normal prompt so continue with next command
      else if @_buffer.match(/[#$]\s$/)
        @_processNextCommand

  _processBuffer: =>
    @sessionText += "#{@_buffer}"
    @response = @_buffer
    #run the command complete callback function
    @sshObj.onCommandComplete @command, @response, @sshObj
    @sshObj.msg.send @_buffer if @sshObj.verbose
    @_buffer = ""

  _processNotifications: =>
    #check for notifications or response output in command
    while @command and ((sessionNote = @command.match(/^`(.*)`$/)) or (msgNote = @command.match(/^msg:(.*)$/)))
      #this is a message for the sessionText like an echo command in bash
      if sessionNote
        @sessionText += "#{sessionNote[1]}\n"
        @sshObj.msg.send( @command.replace(/`/g, "") ) if @sshObj.verbose

      #this is a response to output like to log or chat
      else if msgNote
        @sshObj.msg.send msgNote[1] unless @sshObj.verbose #don't send if in verbose mode
      
      #load the next command and repeat the checks
      @command = @sshObj.commands.shift()

  _processNextCommand: =>
    if !@_exit
        #Buffer complete so process the buffer before the next command
        @_processBuffer()
    #process the next command if there are any
    if @sshObj.commands.length > 0
      @command = @sshObj.commands.shift()
      
      #process non ssh commands
      @_processNotifications()
      
      #if there is still a command to run then run it or exit
      if @command
        #@sshObj.msg.send "next command: #{@command}"
        @stream.write "#{@command}\n"
      else
        #no more commands so exit
        @_runExit()
    else
      #no more commands so exit
      @_runExit()

  _runExit: =>
    @_exit = true
    @command = "exit\n"
    
    #sudo su needs exit sent twice to terminate the session
    if @_sudosu
      @stream.write "exit\n"
      @_sudosu = false
    else
      @stream.end "exit\n"
  
  constructor: (@sshObj) ->
  
  connect: =>
    if @sshObj.server and @sshObj.commands
      try
        @connection = new require('ssh2')()
        @connection.on "connect", =>
          @sshObj.msg.send @sshObj.connectedMessage

        @connection.on "ready", =>
          @sshObj.msg.send @sshObj.readyMessage

          #open a shell
          @connection.shell (err, @stream) =>
            if err then @sshObj.msg.send "#{err}"
            
            @stream.on "error", (error) =>
              @sshObj.msg.send "Stream Error: #{error}"

            @stream.stderr.on 'data', (data) =>
              @sshObj.msg.send "Stream STDERR: #{data}"
              
            @stream.on "readable", =>
              try
                while (data = @stream.read())
                  @_data = "#{data}"
                  @_processData()
              catch e
                @sshObj.msg.send "#{e} #{e.stack}"
                
            @stream.on "end", =>
              #run the on end callback function
              @sshObj.onEnd @sessionText, @sshObj
            
            @stream.on "close", (code, signal) =>
              @connection.end()
            
            #Run the first command to start the process
            #all other commands are run from within on readable event
            @command = @sshObj.commands.shift()
            @_processNotifications()
            @stream.write "#{@command}\n"

        @connection.on "error", (err) =>
          @sshObj.msg.send "Connection :: error :: " + err

        @connection.on "close", (had_error) =>
          @sshObj.msg.send @sshObj.closedMessage
        
        #set connection details  
        if @sshObj.server.privateKey
          @connection.connect
            host:       @sshObj.server.host
            port:       @sshObj.server.port
            username:   @sshObj.server.userName
            privateKey: @sshObj.server.privateKey
            passphrase: @sshObj.server.passPhrase
        else
          @connection.connect
            host:       @sshObj.server.host
            port:       @sshObj.server.port
            username:   @sshObj.server.userName
            password:   @sshObj.server.password
      catch e
        @sshObj.msg.send "#{e} #{e.stack}"
    else
      @sshObj.msg.send "SSH error: missing info: server: #{@sshObj.server.host}, commands: #{@sshObj.commands.length}"
      

module.exports = SSH2Shell
