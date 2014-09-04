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
  sessionText:   ""
  command:       ""
  response:      ""
  _stream:       {}
  _data:         ""
  _buffer:       ""
  _pwSent:       false
  _sshAuth:      false
  
  _processData: ->
    #remove non-standard ascii from terminal responses
    @_data = @_data.replace(/[^\r\n\x20-\x7e]/g, "")
    #remove other weird nonstandard char representation from responses like [32m[31m
    @_data = @_data.replace(/(\[[0-9]?[0-9]m)/g, "")
    @_buffer += "#{@_data}"
    
    #check if sudo password is needed
    if @command.indexOf("sudo ") isnt -1 
      @_processPasswordPrompt()
    #check if ssh authentication needs to be handled
    else if @command.indexOf("ssh ") isnt -1
      @_processSSHPrompt()
    #Command prompt so run the next command
    else if @_buffer.match(/[#$]\s$/)
      @_processNextCommand()
    #command still processing
    else
      @sshObj.onCommandProcessing @command, @_buffer, @sshObj, @_stream

  _processPasswordPrompt: =>
    #First test for password
    unless @_pwSent
      #when the buffer is fully loaded the prompt can be detected
      if @_buffer.match(/password.*:\s$/i)
        @_pwSent = true
        @_stream.write "#{@sshObj.server.password}\n"        
    #password sent so either check for failure or run next command  
    else
      #reprompted for password again so failed password 
      if @_buffer.match(/password.*:\s$/i)
        @sshObj.msg.send "#{@sshObj.server.host}: Error: Sudo password was incorrect for #{@sshObj.server.userName}, leaving host."
        @sshObj.msg.send "#{@sshObj.server.host}: password: #{@sshObj.server.password}" if @sshObj.verbose
        #add buffer to sessionText so the sudo response can be seen
        @sessionText += "#{@_buffer}"
        @sshObj.commands = []
        @_runExit()
        
      #normal prompt so continue with next command
      else if @_buffer.match(/[#$]\s$/)
        @_processNextCommand()
        
  _processSSHPrompt: =>
    #not authenticated yet so detect prompts
    unless @_sshAuth
      #provide password if prompted
      if @_buffer.match(/password.*:\s$/i)        
        @_sshAuth = true
        @_stream.write "#{@sshObj.server.password}\n"
        
      #provide passphrase if prompted
      else if @_buffer.match(/passphrase.*:\s$/i)
        @_sshAuth = true
        @_stream.write "#{@sshObj.server.passPhrase}\n"
        
      #normal prompt so continue with next command
      else if @_buffer.match(/[#$]\s$/)
        @_sshAuth = true
        @_processNextCommand()
    else 
      #detect failed authentication
      if (password = @_buffer.match(/password.*:\s$/i)) or @_buffer.match(/passphrase.*:\s$/i)
        @_sshAuth = false
        @sshObj.msg.send "Error: SSH authentication failed for #{@sshObj.server.userName}@#{@sshObj.server.host}"
        if @sshObj.verbose
          @sshObj.msg.send "Using " + (if password then "password: #{@sshObj.server.password}" else "passphrase: #{@sshObj.server.passPhrase}")
        #no connection so drop back to first host settings if there was one
        if @_connections.length > 0
          @sshObj = @_connections.pop()
        @_runExit()
        
      #normal prompt so continue with next command
      else if @_buffer.match(/[#$]\s$/)
        @_processNextCommand()
        
  _processBuffer: =>
    @sessionText += "#{@_buffer}"
    @response = @_buffer
    #run the command complete callback function
    @sshObj.onCommandComplete @command, @response, @sshObj
    @sshObj.msg.send @_buffer if @sshObj.verbose 
    @_buffer = ""

  _processNotifications: =>
    #check for notifications in commands
    while @command and ((sessionNote = @command.match(/^`(.*)`$/)) or (msgNote = @command.match(/^msg:(.*)$/)))
      #this is a message for the sessionText like an echo command in bash
      if sessionNote
        @sessionText += "#{@sshObj.server.host}: #{sessionNote[1]}\n"
        @sshObj.msg.send sessionNote[1] if @sshObj.verbose

      #this is a message to output in process
      else if msgNote
        @sshObj.msg.send "#{@sshObj.server.host}: #{msgNote[1]}" unless @sshObj.verbose #don't send if in verbose mode
      
      #load the next command and repeat the checks
      @command = @sshObj.commands.shift()

  _processNextCommand: =>
    #check sudo su or ssh has been authenticated and add an extra exit command
    if @command.indexOf("sudo su") isnt -1 or @command.indexOf("ssh ") isnt -1
      @sshObj.exitCommands.push "exit" 
      
    if @command isnt "exit" and @command.indexOf("sudo su") is -1
      #Not running an exit or sudo su command and buffer complete so process it before next command
      @_processBuffer()
      
    #process the next command if there are any
    if @sshObj.commands.length > 0
      @command = @sshObj.commands.shift()
      #process notification commands
      @_processNotifications()
      
      #if there is still a command to run then run it or exit
      if @command
        @_runCommand()
      else
        #no more commands so exit
        @_runExit()
    else
      #no more commands so exit
      @_runExit()
      
  _nextHost: =>
    @_connections.push @sshObj 
    @sshObj = @sshObj.hosts.pop()
    @sshObj.exitCommands = []
    @command = "ssh #{@sshObj.server.userName}@#{@sshObj.server.host}"
    @_sshAuth = false
    @_runCommand()
    
  _runCommand: =>
    #@sshObj.msg.send "next command: #{@command}"
    @_stream.write "#{@command}\n"
    
  _runExit: =>
    #run the exit commands loaded by ssh and sudo su commands
    if @sshObj.exitCommands.length > 0
      @command = @sshObj.exitCommands.pop
      @_runCommand()
    #more hosts to connect to so process the next one
    else if @sshObj.hosts.length > 0
        @_nextHost()
    #Leaving last host so load previous host 
    else if @_connections.length > 0
      @sshObj = @_connections.pop()
      @_processNextCommand()
    else
      @_stream.end "exit\n"
  
  constructor: (@sshObj) ->
  
  connect: ()=>
    if @sshObj.server and @sshObj.commands
      try
        @connection = new require('ssh2')()
                
        @connection.on "connect", =>
          @sshObj.msg.send @sshObj.connectedMessage

        @connection.on "ready", =>
          @sshObj.msg.send @sshObj.readyMessage

          #open a shell
          @connection.shell (err, @_stream) =>
            if err then @sshObj.msg.send "#{err}"
            @sshObj.exitCommands = []
            
            @_stream.on "error", (error) =>
              @sshObj.msg.send "Stream Error: #{error}"

            @_stream.stderr.on 'data', (data) =>
              @sshObj.msg.send "Stream STDERR: #{data}"
              
            @_stream.on "readable", =>
              try
                while (data = @stream.read())
                  @_data = "#{data}"
                  @_processData()
              catch e
                @sshObj.msg.send "#{e} #{e.stack}"
                
            @_stream.on "end", =>
              #run the on end callback function
              @sshObj.onEnd @sessionText, @sshObj
            
            @_stream.on "close", (code, signal) =>
              @connection.end()
            
        @connection.on "error", (err) =>
          @sshObj.msg.send "Connection :: error :: " + err

        @connection.on "close", (had_error) =>
          @sshObj.msg.send @sshObj.closedMessage
        
        #Handle different primary host connection types  
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
