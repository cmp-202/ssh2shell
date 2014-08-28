class SSHShell
  sshObj:        {}
  sessionText:   ""
  response:      ""
  _data:         ""
  _buffer:       ""
  _command:      ""
  _pwSent:       false
  _sudosu:       false
  _exit:         false
  _stream:       {}
  
  _processData: ->
    #remove non-standard ascii from terminal responses
    @_data = @_data.replace(/[^\r\n\x20-\x7e]/g, "")
    #remove other weird nonstandard char representation from responses like [32m[31m
    @_data = @_data.replace(/(\[[0-9]?[0-9]m)/g, "")
    @_buffer += "#{@_data}"
    #check if password is needed
    if @_pwSent is false and @_command.indexOf("sudo") isnt -1
      @_processPasswordPrompt()
    else
      @_processCommandPrompt()

  _processPasswordPrompt: ->
    #when the buffer is fully loaded the prompt can be detected
    if @_buffer.trim().match(/[:]$/)
      #check sudo su has been used and not just sudo for adding an extra exit command later
      if @_command.indexOf("sudo su") isnt -1
        @_sudosu = true        
      #set the pwsent flag and send the password for sudo
      @_pwSent = true
      @_stream.write "#{@sshObj.server.password}\n"

  _processCommandPrompt: ->    
    #detect the command prompt waiting for the next command
    if @_buffer.trim().match(/[#$]$/)
      #Buffer complete so process the buffer before the next command
      @_processBuffer()
      #process the next command
      @_processNextCommand()

  _processBuffer: ->
    @sessionText += "#{@_buffer}" 
    @response = @_buffer
    #run the command complete callback function
    @sshObj.onCommandComplete @ 
    @sshObj.msg.send @_buffer if @sshObj.verbose and !@_exit
    @_buffer = ""

  _processNotifications: ->
    #check for notifications or response output in command
    while @_command and (@_command.match(/^`(.*)`$/) or @_command.match(/^msg\s/))
      
      #this is a message for the sessionText like an echo command in bash
      if @_command.match(/^`(.*)`$/)  
        @sessionText += "#{@_command}\n".replace(/`/g, "")
        @sshObj.msg.send( @_command.replace(/`/g, "") ) if @sshObj.verbose
        
      #this is a response to output like to log or chat
      else if @_command.match(/^msg\s/) 
        @sshObj.msg.send @_command.replace(/^msg\s/, "") unless @sshObj.verbose #don't send if in verbose mode
      
      #load the next command and repeat the checks
      @_command = @sshObj.commands.shift()

  _processNextCommand: ->
    #process the next command if there are any
    if @sshObj.commands.length > 0
      @_command = @sshObj.commands.shift()
      
      #process non ssh commands
      @_processNotifications()
      
      #if there is still a command to run then run it or exit
      if @_command
        #@sshObj.msg.send "next command: #{@_command}"
        @_stream.write "#{@_command}\n"
      else
        #no more commands so exit
        @_runExit()
    else
      #no more commands so exit
      @_runExit()

  _runExit: ->
    @_exit = true
    @_command = "exit\n"
    
    #sudo su needs exit sent twice to terminate the session
    if @_sudosu and !@_exit
      @_stream.write "exit\n"
    else
      @_stream.end "exit\n"
  
  constructor: (@sshObj) ->
  
  connect: ->
    if @sshObj.server and @sshObj.commands
      try
        @connection = new @sshObj.Connection()
        @connection.on "connect", ->
          @sshObj.msg.send @sshObj.connectedMessage

        @connection.on "ready", ->
          @sshObj.msg.send @sshObj.readyMessage      

          #open a shell
          @connection.shell (err, @_stream) ->
            if err then @sshObj.msg.send "#{err}"
            
            @_stream.on "error", (error) ->
              @sshObj.msg.send "Stream Error: #{error}"

            @_stream.stderr.on 'data', (data) ->
              @sshObj.msg.send "Stream STDERR: #{data}"
              
            @_stream.on "readable", ->
              try
                while (@_data = @_stream.read())
                  @_processData()
              catch e
                @sshObj.msg.send "#{e} #{e.stack}" 
                
            @_stream.on "end", ->
              #run the on end callback function
              @sshObj.onEnd @sessionText
            
            @_stream.on "close", (code, signal) ->
              @connection.end()
            
            #Run the first command to start the process
            #all other commands are run from within on readable event
            @_command = @sshObj.commands.shift()
            @_stream.write "#{@_command}\n"

        @connection.on "error", (err) ->
          @sshObj.msg.send "Connection :: error :: " + err

        @connection.on "close", (had_error) ->
          @sshObj.msg.send @sshObj.closedMessage
        
        #set connection details        
        @connection.connect
          host:       @sshObj.server.host
          port:       @sshObj.server.port
          username:   @sshObj.server.userName
          privateKey: @sshObj.server.privateKey
      catch e
        @sshObj.msg.send "#{e} #{e.stack}"
    else
      @sshObj.msg.send "SSH error: missing info: server: #{@sshObj.server.host}, commands: #{@sshObj.commands.length}"
      
  @runShell: ( @sshObj ) ->
    connect()

module.exports = SSHShell