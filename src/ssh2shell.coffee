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
#   hosts:               [Array of sshObj host configs to connect to from this host],
#   commands:            [Array of command strings],
#   msg:                 {
#     send: function( message ) {
#       [message handler code]
#     }
#   }, 
#   verbose:             true/false, #determines if all command output is processed by message handler as it runs]
#   debug:               true/false, #outputs process messages
#   connectedMessage:    "[on Connected message]",
#   readyMessage:        "[on Ready message]",
#   closedMessage:       "[on End message]",
#   onCommandProcessing: function( command, response, sshObj, stream ) {
#     [callback function, optional code to run during the procesing of a command]
#   },
#   onCommandComplete:   function( command, response, sshObj ) {
#     [callback function, optional code to run on the completion of a command]
#   },
#   onEnd:               function( sessionText, sshObj ) {
#     [callback function, optional code to run at the end of a host session]
#   }
# }
#================================

class SSH2Shell
  sshObj:        {}
  command:       ""
  response:      ""
  _stream:       {}
  _data:         ""
  _buffer:       ""
  _connections:  []
  
  _processData: ->
    #remove non-standard ascii from terminal responses
    @_data = @_data.replace(/[^\r\n\x20-\x7e]/g, "")
    #remove other weird nonstandard char representation from responses like [32m[31m
    @_data = @_data.replace(/(\[[0-9]?[0-9]m)/g, "")
    @_buffer += @_data
    #@sshObj.msg.send "#{@sshObj.server.host}: #{@_buffer}" if @sshObj.debug

    #check if sudo password is needed
    if @command.indexOf("sudo ") isnt -1    
      @_processPasswordPrompt()
    #check if ssh authentication needs to be handled
    else if @command.indexOf("ssh ") isnt -1
      @_processSSHPrompt()
    #Command prompt so run the next command
    else if @_buffer.match(/[#$]\s$/)
      @sshObj.msg.send "#{@sshObj.server.host}: normal prompt" if @sshObj.debug
      @_processNextCommand()
    #command still processing
    else
      @sshObj.onCommandProcessing @command, @_buffer, @sshObj, @_stream

  _processPasswordPrompt: =>
    #First test for password prompt
    unless @sshObj.pwSent
      #when the buffer is fully loaded the prompt can be detected
      if @_buffer.match(/password.*:\s$/i)
        @sshObj.msg.send "#{@sshObj.server.host}: Send password [#{@sshObj.server.password}]" if @sshObj.debug
        @sshObj.pwSent = true
        @_stream.write "#{@sshObj.server.password}\n"        
    #password sent so either check for failure or run next command  
    else
      #reprompted for password again so failed password 
      if @_buffer.match(/password.*:\s$/i)  
        @sshObj.msg.send "#{@sshObj.server.host}: Error: Sudo password was incorrect for #{@sshObj.server.userName}, leaving host."
        @sshObj.msg.send "#{@sshObj.server.host}: password: [#{@sshObj.server.password}]" if @sshObj.debug
        #add buffer to sessionText so the sudo response can be seen
        @sshObj.sessionText += "#{@_buffer}"
        @_buffer = ""
        @sshObj.commands = []
        @_stream.write '\x03'
        
      #normal prompt so continue with next command
      else if @_buffer.match(/[#$]\s$/)
        @_processNextCommand()
        
  _processSSHPrompt: =>
    #not authenticated yet so detect prompts
    unless @sshObj.sshAuth
      #provide password
      if @_buffer.match(/password.*:\s$/i)
        @sshObj.msg.send "#{@sshObj.server.host}: ssh password prompt" if @sshObj.debug
        @sshObj.sshAuth = true
        @_stream.write "#{@sshObj.server.password}\n"
      #provide passphrase
      else if @_buffer.match(/passphrase.*:\s$/i)
        @sshObj.msg.send "#{@sshObj.server.host}: ssh passphrase prompt" if @sshObj.debug
        @sshObj.sshAuth = "true"
        @_stream.write "#{@sshObj.server.passPhrase}\n"
      #normal prompt so continue with next command
      else if @_buffer.match(/[#$]\s$/)
        @sshObj.msg.send "ssh auth normal prompt" if @sshObj.debug
        @sshObj.sshAuth = true
        @_processNextCommand()
    else 
      #detect failed authentication
      if (password = @_buffer.match(/password.*:\s$/i)) or @_buffer.match(/passphrase.*:\s$/i)
        @sshObj.sshAuth = false      
        @sshObj.msg.send "Error: SSH authentication failed for #{@sshObj.server.userName}@#{@sshObj.server.host}"
        if @sshObj.debug
          @sshObj.msg.send "Using " + (if password then "password: [#{@sshObj.server.password}]" else "passphrase: [#{@sshObj.server.passPhrase}]")
        #no connection so drop back to first host settings if there was one
        if @_connections.length > 0
          @sshObj = @_connections.pop()
        #@_stream.signal 'INT'
        @_stream.write '\x03'
 
      #normal prompt so continue with next command
      else if @_buffer.match(/[#$]\s$/)
        @sshObj.msg.send "ssh normal prompt" if @sshObj.debug
        @_processNextCommand()
        
  _processNotifications: =>
    #check for notifications in commands
    while @command and ((sessionNote = @command.match(/^`(.*)`$/)) or (msgNote = @command.match(/^msg:(.*)$/)))
      #this is a message for the sessionText like an echo command in bash
      if sessionNote
        @sshObj.sessionText += "#{@sshObj.server.host}: #{sessionNote[1]}\n"
        @sshObj.msg.send sessionNote[1] if @sshObj.verbose

      #this is a message to output in process
      else if msgNote
        @sshObj.msg.send "#{@sshObj.server.host}: #{msgNote[1]}"
      
      #load the next command and repeat the checks
      @command = @sshObj.commands.shift()

  _processBuffer: =>
    @sshObj.sessionText += "#{@_buffer}"
    @response = @_buffer
    @sshObj.onCommandComplete @command, @response, @sshObj
    @sshObj.msg.send "#{@sshObj.server.host} verbose:#{@_buffer}" if @sshObj.verbose 
    @_buffer = ""

  _processNextCommand: =>
    #check sudo su or ssh has been authenticated and add an extra exit command
    if @command.indexOf("sudo su") isnt -1
      @sshObj.exitCommands.push "exit" 
      
    if @command isnt "exit"
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
         
  _runCommand: =>
    @sshObj.msg.send "#{@sshObj.server.host}: next command: #{@command}" if @sshObj.debug
    @_stream.write "#{@command}\n"
    
  _nextHost: =>
    @_processBuffer()
    @nextHost = @sshObj.hosts.shift()
    @sshObj.msg.send "#{@sshObj.server.host}: ssh to #{@nextHost.server.host}" if @sshObj.debug  
    @_connections.push @sshObj
    if @sshObj.hosts.length is 0
      @sshObj.exitCommands.push "exit"  
    @sshObj = @nextHost
    @sshObj.exitCommands = []
    @sshObj.pwSent = false
    @sshObj.sessionText = ""
    @sshObj.sshAuth = false
    @command = "ssh -oStrictHostKeyChecking=no #{@sshObj.server.userName}@#{@sshObj.server.host}"    
    @_runCommand()
 
  _runExit: =>
    #run the exit commands loaded by ssh and sudo su commands
    if @sshObj.exitCommands and @sshObj.exitCommands.length > 0
      @sshObj.msg.send "#{@sshObj.server.host}: Queued exit commands: #{@sshObj.exitCommands}" if @sshObj.debug
      @command = @sshObj.exitCommands.pop()
      @_runCommand()
    #more hosts to connect to so process the next one
    else if @sshObj.hosts and @sshObj.hosts.length > 0
      @sshObj.msg.send "\n#{@sshObj.server.host}: Queued hosts for this host:" if @sshObj.debug
      @sshObj.msg.send @sshObj.hosts if @sshObj.debug
      @_nextHost()
    #Leaving last host so load previous host 
    else if @_connections and @_connections.length > 0
      @sshObj.msg.send "\nParked hosts:" if @sshObj.debug
      @sshObj.msg.send @_connections if @sshObj.debug
      @sshObj.onEnd( @sshObj.sessionText, @sshObj )
      @sshObj = @_connections.pop()
      @sshObj.msg.send "loaded previous host object for: #{@sshObj.server.host}" if @sshObj.debug
      if @_connections.length > 0
        @sshObj.exitCommands.push "exit"
      @_processNextCommand()
    else
      @sshObj.msg.send "Exit and close connection on: #{@sshObj.server.host}" if @sshObj.debug
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
          @connection.shell { pty: true }, (err, @_stream) =>
            if err then @sshObj.msg.send "#{err}"
            @sshObj.exitCommands = []
            @sshObj.pwSent = false
            @sshObj.sshAuth = false
            @sshObj.sessionText = ""
            
            @_stream.on "error", (error) =>
              @sshObj.msg.send "Stream Error: #{error}"

            @_stream.stderr.on 'data', (data) =>
              @sshObj.msg.send "Stream STDERR: #{data}"
              
            @_stream.on "readable", =>
              try
                while (data = @_stream.read())
                  @_data = "#{data}"
                  @_processData()
              catch e
                @sshObj.msg.send "#{e} #{e.stack}"
                
            @_stream.on "end", =>
              #run the on end callback function
              @sshObj.onEnd @sshObj.sessionText, @sshObj
            
            @_stream.on "close", (code, signal) =>
              @connection.end()
          
        @connection.on "error", (err) =>
          @sshObj.msg.send "Connection :: error :: " + err

        @connection.on "close", (had_error) =>
          @sshObj.msg.send @sshObj.closedMessage

        @connection.connect
          host:       @sshObj.server.host
          port:       @sshObj.server.port
          username:   @sshObj.server.userName
          password:   @sshObj.server.password
          privateKey: @sshObj.server.privateKey
          passphrase: @sshObj.server.passPhrase

      catch e
        @sshObj.msg.send "#{e} #{e.stack}"
    else
      @sshObj.msg.send "SSH error: missing info: server: #{@sshObj.server.host}, commands: #{@sshObj.commands.length}"
      

module.exports = SSH2Shell
