/**
 * Direct RPC protocol tester for `pi --mode rpc`
 * 
 * This script starts `pi --mode rpc` as a subprocess and speaks the JSONL protocol
 * directly over stdin/stdout, bypassing the WebSocket layer.
 * 
 * Usage:
 *   node test-rpc-direct.js [provider] [model] [api-key]
 * 
 * Examples:
 *   node test-rpc-direct.js                    # Use defaults (anthropic, model in .env)
 *   node test-rpc-direct.js anthropic          # Specify provider
 *   node test-rpc-direct.js anthropic gpt-4o   # Specify provider and model
 */

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

// Configuration
const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

// Parse arguments
const args = process.argv.slice(2);
const provider = args[0] || process.env.PI_PROVIDER || DEFAULT_PROVIDER;
const model = args[1] || process.env.PI_MODEL || DEFAULT_MODEL;
const apiKey = args[2] || process.env.PI_API_KEY || null;
const cwd = args[3] || null;

console.log('='.repeat(60));
console.log('Direct RPC Protocol Tester for `pi --mode rpc`');
console.log('='.repeat(60));
console.log(`Provider: ${provider}`);
console.log(`Model: ${model}`);
console.log(`API Key: ${apiKey ? 'Configured' : 'Not configured'}`);
console.log(`Working Directory: ${cwd || 'default'}`);
console.log('='.repeat(60));

// Build the command to spawn
const cmd = ['pi', '--mode', 'rpc'];
if (apiKey) cmd.push('--api-key', apiKey);
cmd.push('--provider', provider);
cmd.push('--model', `${provider}/${model}`);
cmd.push('--thinking', process.env.PI_THINKING_LEVEL || 'medium');
cmd.push('--no-session');

console.log('\n📋 Command:', cmd.join(' '), '\n');

// Spawn the subprocess
const agent = spawn(cmd[0], cmd.slice(1), {
  cwd: cwd || undefined,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    ...(cwd ? { CWD: cwd } : {}),
  },
});

let buffer = '';
let requestId = 1;
let modelsReceived = false;
let errorOccurred = false;
let agentOutputCaptured = false;

// Output stream
const output = {
  write: (chunk) => {
    const raw = chunk.toString();
    buffer += raw;
    processEvents();
  }
};

// Parse and process events from the agent
function processEvents() {
  let newLineIndex;
  while ((newLineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newLineIndex).trim();
    buffer = buffer.slice(newLineIndex + 1);
    
    if (!line) continue;

    // Handle potential carriage return
    const cleanLine = line.endsWith('\r') ? line.slice(0, -1) : line;

    try {
      const event = JSON.parse(cleanLine);
      console.log('📥 Event:', JSON.stringify(event, null, 2).split('\n').join('\n    '));
      processEvent(event);
    } catch (e) {
      console.log('⚠️  Parse error:', e.message);
    }
  }
}

// Process individual events
function processEvent(event) {
  if (event.type === 'agent_start') {
    console.log('✅ Agent has started\n');
  }

  if (event.type === 'turn_start') {
    console.log('💬 Turn started\n');
  }

  if (event.type === 'message_update') {
    // Show partial content if streaming
    if (event.assistantMessageEvent?.type === 'text_delta' && event.assistantMessageEvent.delta) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  }

  if (event.type === 'response') {
    if (!event.success) {
      console.log('\n❌ Command failed:', event.error);
      errorOccurred = true;
    }

    if (event.command === 'get_available_models') {
      modelsReceived = true;
      console.log('\n📊 Model Fetch Result:');
      console.log('  Success:', event.success);
      console.log('  Id:', event.id || '(none)');

      if (event.data) {
        const data = event.data;
        console.log('  Models count:', data.models?.length || 0);
        console.log('  Current model:', data.current?.id || null);

        if (data.models && data.models.length > 0) {
          console.log('\n📦 Available Models:');
          data.models.forEach((model, i) => {
            console.log(`    ${i + 1}. ${model.name} (${model.id})`);
            console.log(`       Provider: ${model.provider}, API: ${model.api}`);
            console.log(`       Context: ${model.contextWindow || '?'} tokens`);
          });
        } else {
          console.log('\n⚠️  NO MODELS AVAILABLE');
          console.log('   This means the agent either:');
          console.log('   - Requires authentication (API key)');
          console.log('   - Needs a model loaded from ~/.pi/agent/');
          console.log('   - Is using a provider with no configured models');
        }
      }
    }

    if (event.command === 'get_state') {
      console.log('\n📊 Agent State:');
      const state = event.data;
      console.log('  Is streaming:', state.isStreaming);
      console.log('  Is compacting:', state.isCompacting);
      console.log('  Model:', state.model?.id || 'not set');
      console.log('  Provider:', state.model?.provider || 'not set');
      console.log('  Thinking level:', state.thinkingLevel);
      console.log('  Session file:', state.sessionFile || 'ephemeral');

      finish();
    }
  }

  if (event.type === 'agent_end') {
    console.log('\n🏁 Agent has finished');
    finish();
  }

  if (event.type === 'message_end' && event.message.role === 'assistant') {
    console.log('\n📝 Assistant response:');
    const text = event.message.content
      ?.filter(c => c.type === 'text')
      ?.map(c => c.text)
      ?.join(' ');
    if (text) {
      console.log('    ' + text);
    }
  }
}

// Send a command to the agent
function sendCommand(command) {
  if (errorOccurred) return;
  
  command.id = 'request-' + requestId++;
  const line = JSON.stringify(command) + '\n';
  console.log(`📤 Command: ${JSON.stringify(command)}\n`);
  agent.stdin.write(line);
}

// Cleanup on exit
function finish() {
  if (!errorOccurred) {
    console.log('\n' + '='.repeat(60));
    console.log('Test complete!');
    console.log('='.repeat(60));
  }
  
  setTimeout(() => {
    agent.kill();
    process.exit(0);
  }, 1000);
}

// Handle agent stderr output
agent.stderr.on('data', (data) => {
  const msg = data.toString();
  // Only show stderr if we haven't started receiving JSON events yet
  if (!agentOutputCaptured) {
    console.log('⚠️  Agent output:', msg);
  }
});

// Handle agent events
agent.stdout.on('data', output.write);

agent.on('error', (err) => {
  console.log('❌ Agent process error:', err.message);
  process.exit(1);
});

agent.on('close', (code) => {
  console.log(`\n👋 Agent exited with code ${code}`);
  process.exit(code);
});

agent.on('exit', (code) => {
  console.log(`\n👋 Agent exited with code ${code}`);
  process.exit(code);
});

// Wait for 10 seconds to capture startup messages
console.log('\n⏳ Waiting 10 seconds for agent to start...');
setTimeout(() => {
  console.log('\n⏱️  Send request after startup wait...\n');
  
  // Try sending the command 3 times with delays
  let attempts = 0;
  const maxAttempts = 3;
  
  function trySendCommand() {
    if (errorOccurred) return;
    
    attempts++;
    if (attempts > maxAttempts) {
      console.log('\n⚠️  Max attempts reached. Agent may not be responding.');
      finish();
      return;
    }
    
    console.log(`\n📤 Sending try #${attempts} of ${maxAttempts}...`);
    sendCommand({
      type: 'get_available_models',
      id: 'request-1',
    });
    
    // Check if we got a response
    setTimeout(() => {
      if (!modelsReceived && !errorOccurred) {
        console.log('\n⚠️  No response to get_available_models.');
        console.log('   Agent may still be initializing...');
        console.log(`   Trying one more time in 2 seconds...`);
        setTimeout(trySendCommand, 2000);
      }
    }, 3000);
  }
  
  setTimeout(trySendCommand, 500);
}, 10000);

// Timeout after 15 seconds total
setTimeout(() => {
  console.log('\n⏱️  Test timeout reached');
  finish();
}, 16000);
