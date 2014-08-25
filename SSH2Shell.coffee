Connection = require "ssh2"

class SSH2Shell
  sshObj:        {}
  fullResponse:  ""
  _data:         ""
  _buffer:       ""  
  _commands:     {}
  _command:      ""
  _pwSent:       false
  _sudosu:       false
  _exit:         false
  _stream:       {}
  _chat:         {}
  
  _processData: ->
    #remove non-standard ascii from terminal responses
    @_data = @_data.replace(/[^\r\n\x20-\x7e]/g, "")
    #remove other weird nonstandard char representation 
    @_data = @_data.replace(/(\[[0-9]?[0-9]m)/g, "")
    #check if password is needed
    if @_pwSent is false and @_command.indexOf("sudo") isnt -1
      @_processPasswordPrompt()
    else
      @_processCommandPrompt()


  _processPasswordPrompt: ->
    #sudo su triggers a data event but doesn't resolve to a password prompt 
    #on the first event so we need to avoid the first event and wait for the 
    #correct password prompt
    if @_data.length > 5 and (@_data.trim().match(/[:]$/) or @_data.indexOf("sudo") isnt -1)
      #check sudo su has been used and not just sudo for adding an extra exit command later
      if @_command.indexOf("sudo su") isnt -1
        @_sudosu = true        
      #set the pwsent flag and send the password for sudo
      @_pwSent = true
      @_stream.write "#{@sshObj.connect.server.password}\n"

  _processCommandPrompt: ->
    #detect the command prompt waiting for the next command
    if @_data.length > 5 and @_data.trim().match(/[#$]$/)
      #Buffer complete so process the buffer before the next command
      @_processBuffer()
      #process the next command
      @_processNextCommand()
    else
      #the data event is a response to the last processed command and is not a command prompt
      #so buffer the data until the next command
      @_buffer += @_data

  _processBuffer: ->
    @fullResponse += "#{@_buffer}"    
    @sshObj.onCommandComplete(@_buffer, @_stream)
    @_chat.send @_buffer if @sshObj.verbose and !@_exit
    @_data = @_buffer
    @_buffer = ""

  _processNotifications: ->
    #check for notifications or response output in command
    while @_command and (@_command.match(/^`(.*)`$/) or @_command.match(/^chat\s/))
      if @_command.match(/^`(.*)`$/) #this is a message for the response like an echo command in bash 
        @fullResponse += "#{@_command}\n".replace(/`/g, "")
        @_chat.send( @_command.replace(/`/g, "") ) if @sshObj.verbose
      else if @_command.match(/^chat\s/) #this is a response to chat
        @_chat.send @_command.replace(/^chat\s/, "") unless @sshObj.verbose #don't send if in verbose mode
      #load the next command and repeat the checks
      @_command = @_commands.shift()

  _processNextCommand: ->
    #process the next command if there are any
    if @_commands.length > 0
      @_command = @_commands.shift()
      #process non ssh commands
      @_processNotifications()
      #if there is stil a command to run then run it or exit
      if @_command
        #@_chat.send "next command: #{@_command}"
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
  
  constructor: () ->
  
  @runShell: ( @sshObj ) ->
    if @sshObj.server and @sshObj.commands
      try
        @_commands = @sshObj.commands
        @_chat = @sshObj.chat
        @connection = new Connection()
        @connection.on "connect", ->
          @_chat.send "Connected"

        @connection.on "ready", ->
          @_chat.send @sshObj.readyMessage      

          #open a shell
          @connection.shell (err, @_stream) ->
            if err then @_chat.send "#{err}"
            
            @_stream.on "error", (error) ->
              @_chat.send "Stream Error: #{error}"

            @_stream.stderr.on 'data', (data) ->
              @_chat.send "Stream STDERR: #{data}"
              
            @_stream.on "readable", ->
              try
                while (data = @_stream.read())
                  @_data = "#{data}"
                  @_processData()
              catch e
                @_chat.send "#{e} #{e.stack}" 
                
            @_stream.on "end", ->
              @sshObj.onEnd()
            
            @_stream.on "close", (code, signal) ->
              @connection.end()
            
            #Run the first command to start the process
            #all other commands are run from within on readable event
            #at command prompt detection
            @_command = @_commands.shift()
            @_stream.write "#{@_command}\n"

        @connection.on "error", (err) ->
          @_chat.send "Connection :: error :: " + err

        @connection.on "close", (had_error) ->
          @_chat.send "Connection Closed"
        #set connection details
        
        @connection.connect
          host:       @sshObj.server.host
          port:       @sshObj.server.port
          username:   @sshObj.server.userName
          privateKey: @sshObj.server.privateKey
      catch e
        @_chat.send "#{e} #{e.stack}"
    else
      @_chat.send "SSH error: missing info: server: #{@sshObj.server.host}, commands: #{@sshObj.commands.length}"
   
    
module.exports = SSH2Shell
