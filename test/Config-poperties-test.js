// Load environment context
require('dotenv').config();

const SSH2Shell = require('../lib/ssh2shell');

// Global configuration options for tracing
const debug = true;
const verbose = true;

// 1. Establish a base trusted host profile using your env variables
const baseHostConfig = {
  server: {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands: ["echo 'Running Base Host Environment Context Verification'"],
  debug: debug,
  verbose: verbose
};

/**
 * Helper function to instantiate and run an isolated test case profile
 * @param {string} testName - Clear label for console logs
 * @param {Object} modifiedConfig - Unique variations to layer over the base profile
 */
function runTestCase(testName, modifiedConfig) {
  console.log(`\n======================================================`);
  console.log(`🚀 STARTING TEST: ${testName}`);
  console.log(`======================================================`);

  // Clone the base host configuration deep enough to prevent test pollution
  const currentHost = JSON.parse(JSON.stringify(baseHostConfig));
  
  // Layer the custom test config definitions over it
  Object.assign(currentHost, modifiedConfig);

  try {
    const SSH = new SSH2Shell(currentHost);
    
    // Catch emitted errors gracefully so a single failure doesn't crash the entire test runner
    SSH.on('error', (err, type) => {
      console.log(`[EVENT MATCH] Caught Expected Library Error Event -> Type: ${type} | Msg: ${err}`);
    });

    SSH.on('msg', (msg) => {
      // Intercept our newly added debug statements specifically
      if (typeof msg === 'string' && msg.includes('reverting to default')) {
        console.log(`[FALLBACK MATCH] Successfully Triggered Sanity Shield: ${msg}`);
      }
    });

    const callback = function(sessionText) {
      console.log(`\n[SUCCESS] Test "${testName}" session output processed securely:`);
      console.log(sessionText);
    };

    SSH.connect(callback);

  } catch (fatalError) {
    console.error(`[FATAL CRASH] Script parsing collapsed unexpectedly:`, fatalError);
  }
}

// =========================================================================
// REGISTERING OUR SECURITY TEST CASES
// =========================================================================

// Test Case 1: Baseline Context Check (Ensures our core library remains functionally intact)
runTestCase("Standard Operational Verification", {
  commands: [
    "echo -e '\\e[31mChecking ANSI Color Filter\\e[0m'",
    "echo -e 'Checking\\tASCII\\tFilter\\tWith\\tTabs'"
  ]
});

// Test Case 2: Command Injection Mitigation via .enter Variable Exploitation
runTestCase("Command Injection Intervention Check", {
  // Attempting an injection vector that would execute an unauthorized secondary statement
  enter: "\n echo 'INJECTION ATTACK SUCCESSFUL - EXPOSED CONTROL BREAK'; #",
  commands: ["echo 'Verifying line ending sanitisation validation boundaries'"]
});

// Test Case 3: ReDoS Exploitation Defense on Malformed ASCII Configurations
runTestCase("Malformed ASCII Regular Expression Reversion", {
  // Injecting a classic nested backtracking structural loop string that violates our validation whitelist
  asciiFilter: "([^\\r\\n\\x20-\\x7e]*)*", 
  commands: ["echo 'Verifying ASCII configuration string fallback pipeline'"]
});

// Test Case 4: ReDoS Exploitation Defense on Malformed ANSI Text Color Configurations
runTestCase("Malformed Color Sequence Loop Mitigation", {
  // Injecting an unclosed capturing group designed to cause compilation failures
  textColorFilter: "(\\[{1}[0-9;]+", 
  commands: ["echo 'Verifying Color configuration string fallback pipeline'"]
});
