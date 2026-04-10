/**
 * Test script to verify RPC model fetching works
 */

const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8000/ws/test-rpc-models-verify-' + Date.now());

console.log('Connecting to RPC server...');

ws.on('open', () => {
  console.log('✅ Connected to WebSocket!\n');
  
  // Send get_available_models command
  console.log('📤 Sending get_available_models command...');
  ws.send(JSON.stringify({ 
    type: 'get_available_models',
    id: 'test-request-1' 
  }));
  
  // Wait 5 seconds then exit
  setTimeout(() => {
    console.log('\n⏱️  Timeout reached\n');
    ws.close();
    process.exit(0);
  }, 5000);
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  
  console.log('📥 Received:', JSON.stringify(message, null, 2));
  
  if (message.type === 'response' && message.command === 'get_available_models') {
    console.log('\n📊 Model Fetch Result:');
    console.log('  Success:', message.success);
    
    if (message.data) {
      const data = message.data;
      console.log('  Models count:', data.models?.length || 0);
      console.log('  Current model:', data.current?.id || null);
      
      if (data.models && data.models.length > 0) {
        console.log('\n📦 Available Models:');
        data.models.forEach((model, i) => {
          console.log(`  ${i + 1}. ${model.name} (${model.id})`);
          console.log(`     Provider: ${model.provider}, API: ${model.api}`);
        });
      } else {
        console.log('\n⚠️  NO MODELS AVAILABLE');
        console.log('   This means the agent either:');
        console.log('   - Requires authentication (API key)');
        console.log('   - Needs a model selected via /model in TUI');
        console.log('   - Is using a provider with no configured models');
      }
    }
  }
  
  if (message.type === 'error') {
    console.log('❌ Error:', message.errorMessage);
  }
});

ws.on('error', (error) => {
  console.log('❌ WebSocket Error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\n👋 Connection closed\n');
});
