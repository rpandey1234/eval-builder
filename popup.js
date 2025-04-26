// Check auth state when popup opens
document.addEventListener('DOMContentLoaded', checkAuthState);
const authButton = document.getElementById('authButton');
const spreadsheetSelect = document.getElementById('spreadsheetSelect');
const approveButton = document.getElementById('approveButton');
const rejectButton = document.getElementById('rejectButton');
const promptInput = document.getElementById('promptInput');
const responseInput = document.getElementById('responseInput');
const inputBox = document.getElementById('inputBox');
const submitToClaude = document.getElementById('submitToClaude');
const claudeResponse = document.getElementById('claudeResponse');
const userGreeting = document.getElementById('userGreeting');
const evaluateButton = document.getElementById('evaluateButton');
const approvedCountDisplay = document.getElementById('approvedCountDisplay');
const evalHarness = document.getElementById('evalHarness');
const promptPrimeDisplay = document.getElementById('promptPrimeDisplay');
const evalResultsList = document.getElementById('evalResultsList');

authButton.addEventListener('click', authenticate);
spreadsheetSelect.addEventListener('change', handleSpreadsheetChange);
approveButton.addEventListener('click', () => handleEvaluation(true));
rejectButton.addEventListener('click', () => handleEvaluation(false));
submitToClaude.addEventListener('click', handleClaudeSubmit);

let currentSpreadsheetId = null;
let anthropicApiKey = '';
let lastClaudeMarkdown = '';
let approvedRows = [];

async function checkAuthState() {
  try {
    const auth = await chrome.identity.getAuthToken({ 
      interactive: false
    });
    
    if (auth && auth.token) {
      const userInfo = await getUserInfo(auth.token);
      showAuthenticatedState(userInfo);
      await listSpreadsheets(auth.token);
    }
  } catch (error) {
    console.log('Not authenticated:', error);
    showUnauthenticatedState();
  }
}

async function getUserInfo(token) {
  const response = await fetch(
    'https://www.googleapis.com/oauth2/v2/userinfo',
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to get user info');
  }
  
  return await response.json();
}

function showAuthenticatedState(userInfo) {
  // Hide the auth button
  authButton.classList.add('hidden');
  
  // Show greeting in the description
  userGreeting.textContent = `Hi, ${userInfo.given_name || userInfo.name}. `;
  
  // Show the spreadsheet selector
  document.getElementById('spreadsheetSelector').classList.add('visible');
}

function showUnauthenticatedState() {
  // Show the auth button
  authButton.classList.remove('hidden');
  
  // Clear the greeting
  userGreeting.textContent = '';
  
  // Hide the spreadsheet selector and eval form
  document.getElementById('spreadsheetSelector').classList.remove('visible');
  document.getElementById('evalForm').classList.remove('visible');
  
  // Reset the select
  const select = document.getElementById('spreadsheetSelect');
  select.innerHTML = '<option value="">Select a spreadsheet...</option>';
  
  // Reset the form
  promptInput.value = '';
  responseInput.value = '';
  inputBox.value = '';
  claudeResponse.textContent = '';
  currentSpreadsheetId = null;
  
  // Clear stored spreadsheet
  chrome.storage.sync.remove('selectedSpreadsheet');
}

async function authenticate() {
  console.log('Authenticating...');
  try {
    const auth = await chrome.identity.getAuthToken({ 
      interactive: true
    });
    
    console.log('Auth result:', auth);
    const userInfo = await getUserInfo(auth.token);
    showAuthenticatedState(userInfo);
    await listSpreadsheets(auth.token);
  } catch (error) {
    console.error('Authentication error:', error);
    showUnauthenticatedState();
  }
}

async function listSpreadsheets(token) {
  try {
    console.log('Using token:', token);
    // Use Drive API to list spreadsheets
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files?' +
      'q=mimeType=\'application/vnd.google-apps.spreadsheet\'' +
      '&fields=files(id,name)',
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', response.status, errorText);
      throw new Error(`API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('Fetched spreadsheets:', data);
    await displaySpreadsheets(data.files || []);
  } catch (error) {
    console.error('Error fetching spreadsheets:', error);
    showMessage(`Error: ${error.message}`, true);
  }
}

function showMessage(text, isError = false) {
  const message = document.getElementById('message');
  message.textContent = text;
  message.style.color = isError ? '#dc3545' : '#666';
}

function handleSpreadsheetChange(event) {
  const selectedValue = event.target.value;
  const selectedName = event.target.options[event.target.selectedIndex].text;
  currentSpreadsheetId = selectedValue;
  
  if (selectedValue) {
    document.getElementById('evalForm').classList.add('visible');

    // Store the selection
    chrome.storage.sync.set({
      selectedSpreadsheet: {
        id: selectedValue,
        name: selectedName
      }
    });

    // Read the API key from the 'API key' sheet, cell A1
    (async () => {
      let auth;
      try {
        auth = await chrome.identity.getAuthToken({ interactive: false });
        if (!auth || !auth.token) {
          console.log('No auth token received for reading spreadsheet (non-interactive). Trying interactive...');
          auth = await chrome.identity.getAuthToken({ interactive: true });
        }
        if (auth && auth.token) {
          // Read API key from the 'API key' sheet
          const apiKeySheetResp = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${selectedValue}/values/API%20key!A1`,
            {
              headers: {
                'Authorization': `Bearer ${auth.token}`
              }
            }
          );
          if (apiKeySheetResp.ok) {
            const apiKeySheetData = await apiKeySheetResp.json();
            anthropicApiKey = (apiKeySheetData.values && apiKeySheetData.values[0] && apiKeySheetData.values[0][0]) || '';
            console.log('Anthropic API key (full):', anthropicApiKey);
          } else {
            console.error('Failed to fetch API key from sheet.');
            const apiKeyDisplay = document.getElementById('apiKeyDisplay');
            if (apiKeyDisplay) {
              apiKeyDisplay.textContent = '(No API key found)';
            }
          }

          // Pre-populate prompt and input from the last non-empty data row
          console.log('Attempting to pre-populate fields from spreadsheet:', selectedValue);
          const sheetData = await readSpreadsheet(auth.token, selectedValue);
          console.log('Fetched sheet data:', sheetData);
          // Use the first sheet
          const sheet = sheetData.sheets && sheetData.sheets[0];
          if (sheet && sheet.data && sheet.data[0] && sheet.data[0].rowData && sheet.data[0].rowData.length > 1) {
            // Filter out empty rows
            const dataRows = sheet.data[0].rowData.slice(1).filter(row => row && row.values && row.values.some(cell => cell && cell.formattedValue));
            const lastRow = dataRows[dataRows.length - 1];
            console.log('Last non-empty data row:', lastRow);
            if (lastRow && lastRow.values) {
              promptInput.value = lastRow.values[1]?.formattedValue || '';
              inputBox.value = lastRow.values[2]?.formattedValue || '';
              console.log('Pre-populated prompt:', promptInput.value);
              console.log('Pre-populated input:', inputBox.value);
            } else {
              console.log('No values found in last data row.');
            }
          } else {
            console.log('No data rows found in sheet.');
          }

          // Count APPROVED rows in column E and store them
          try {
            if (sheet && sheet.data && sheet.data[0] && sheet.data[0].rowData && sheet.data[0].rowData.length > 1) {
              // Get all data rows (skip header)
              const dataRows = sheet.data[0].rowData.slice(1);
              approvedRows = dataRows.filter(row => row && row.values && row.values[4]?.formattedValue === 'APPROVED');
              approvedCountDisplay.textContent = `Approved rows: ${approvedRows.length}`;
            } else {
              approvedRows = [];
              approvedCountDisplay.textContent = 'Approved rows: 0';
            }
          } catch (err) {
            approvedRows = [];
            approvedCountDisplay.textContent = 'Approved rows: 0';
          }
        } else {
          console.log('No auth token received for reading spreadsheet (even after interactive).');
        }
      } catch (err) {
        console.error('Error pre-populating fields or fetching API key:', err);
      }
    })();
  } else {
    document.getElementById('evalForm').classList.remove('visible');
    showMessage('Please select a spreadsheet.');
    chrome.storage.sync.remove('selectedSpreadsheet');
    const apiKeyDisplay = document.getElementById('apiKeyDisplay');
    if (apiKeyDisplay) {
      apiKeyDisplay.textContent = '';
    }
  }
}

function setApproveRejectEnabled(enabled) {
  approveButton.disabled = !enabled;
  rejectButton.disabled = !enabled;
}

// Initially disable approve/reject
setApproveRejectEnabled(false);

// Enable/disable approve/reject based on field values
function updateApproveRejectState() {
  const hasPrompt = !!promptInput.value.trim();
  const hasInput = !!inputBox.value.trim();
  const hasResponse = !!claudeResponse.textContent.trim();
  setApproveRejectEnabled(hasPrompt && hasInput && hasResponse);
}

promptInput.addEventListener('input', () => {
  claudeResponse.textContent = '';
  claudeResponse.innerHTML = '';
  updateApproveRejectState();
});
inputBox.addEventListener('input', () => {
  claudeResponse.textContent = '';
  claudeResponse.innerHTML = '';
  updateApproveRejectState();
});

async function handleClaudeSubmit() {
  if (!promptInput.value || !inputBox.value) {
    showMessage('Please fill in both prompt and input.', true);
    return;
  }
  if (!anthropicApiKey) {
    showMessage('No Anthropic API key loaded.', true);
    return;
  }

  try {
    submitToClaude.disabled = true;
    claudeResponse.textContent = 'Waiting for Claude...';
    updateApproveRejectState();
    
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    console.log('Claude API request headers:', headers);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: `${promptInput.value}\n\nInput: ${inputBox.value}`
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const markdown = data.content[0].text;
    lastClaudeMarkdown = markdown;
    claudeResponse.innerHTML = window.marked ? window.marked.parse(markdown) : markdown;
    showMessage('Response received from Claude!');
    updateApproveRejectState();
  } catch (error) {
    console.error('Error calling Claude API:', error);
    showMessage(`Error: ${error.message}`, true);
    claudeResponse.textContent = 'Error getting response from Claude.';
    claudeResponse.innerHTML = '<span style="color:#dc3545">Error getting response from Claude.</span>';
    updateApproveRejectState();
  } finally {
    submitToClaude.disabled = false;
  }
}

async function handleEvaluation(isApproved) {
  if (!currentSpreadsheetId || !promptInput.value || !inputBox.value || !claudeResponse.textContent) {
    showMessage('Please fill in prompt, input, and get a response from Claude first.', true);
    return;
  }

  try {
    setApproveRejectEnabled(false);
    const auth = await chrome.identity.getAuthToken({ interactive: false });
    const values = [[
      new Date().toISOString(),
      promptInput.value,
      inputBox.value,
      lastClaudeMarkdown,
      isApproved ? 'APPROVED' : 'REJECTED'
    ]];
    // Save to A1:E1 (5 columns)
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${currentSpreadsheetId}/values/Sheet1!A1:E1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );
    // Optionally clear fields or show a message
    showMessage(isApproved ? 'Evaluation approved and saved!' : 'Evaluation rejected and saved.');
    setTimeout(() => { window.close(); }, 500); // Close extension popup after save
  } catch (error) {
    console.error('Error saving evaluation:', error);
    showMessage(`Error saving evaluation: ${error.message}`, true);
    setApproveRejectEnabled(true);
  }
}

// Helper function to read spreadsheet data using Sheets API
async function readSpreadsheet(token, spreadsheetId) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=true`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to read spreadsheet: ${response.statusText}`);
  }
  
  return await response.json();
}

// Helper function to append data to spreadsheet
async function appendToSpreadsheet(token, spreadsheetId, values) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:D1:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: values
      })
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to append to spreadsheet: ${response.statusText}`);
  }
  
  return await response.json();
}

async function displaySpreadsheets(spreadsheets) {
  const select = document.getElementById('spreadsheetSelect');
  select.innerHTML = '<option value="">Select a spreadsheet...</option>';
  
  if (!spreadsheets || spreadsheets.length === 0) {
    showMessage('No spreadsheets found.');
    return;
  }

  spreadsheets.forEach(sheet => {
    const option = document.createElement('option');
    option.value = sheet.id;
    option.textContent = sheet.name;
    select.appendChild(option);
  });

  // Restore previously selected spreadsheet
  try {
    const { selectedSpreadsheet } = await chrome.storage.sync.get('selectedSpreadsheet');
    if (selectedSpreadsheet && selectedSpreadsheet.id) {
      select.value = selectedSpreadsheet.id;
      currentSpreadsheetId = selectedSpreadsheet.id;
      // Explicitly call handleSpreadsheetChange to trigger pre-population
      handleSpreadsheetChange({ target: select });
    } else {
      showMessage('Please select a spreadsheet.');
    }
  } catch (error) {
    console.error('Error restoring spreadsheet selection:', error);
    showMessage('Please select a spreadsheet.');
  }
}

// Add a placeholder click handler for the Evaluate button
if (evaluateButton) {
  evaluateButton.addEventListener('click', async () => {
    // Hide main UI, show eval harness UI
    document.getElementById('evalForm').style.display = 'none';
    evaluateButton.style.display = 'none';
    approvedCountDisplay.style.display = 'none';
    evalHarness.style.display = 'block';

    // Use the current prompt as prompt_prime
    const promptPrime = promptInput.value;
    promptPrimeDisplay.textContent = promptPrime;

    // Clear previous results
    evalResultsList.innerHTML = '';

    // For each approved row, call Claude with (prompt_prime, input)
    for (let i = 0; i < approvedRows.length; i++) {
      const row = approvedRows[i];
      const input = row.values[2]?.formattedValue || '';
      // Add a placeholder list item
      const li = document.createElement('li');
      li.textContent = `Input: ${input} | Similarity: ...`;
      evalResultsList.appendChild(li);

      // Call Claude with (prompt_prime, input)
      let similarity = '';
      try {
        if (anthropicApiKey && promptPrime && input) {
          const headers = {
            'Content-Type': 'application/json',
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          };
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: 'claude-3-7-sonnet-20250219',
              max_tokens: 1000,
              messages: [
                {
                  role: 'user',
                  content: `${promptPrime}\n\nInput: ${input}`
                }
              ]
            })
          });
          if (response.ok) {
            // For now, use a dummy similarity value
            similarity = '0.85';
          } else {
            similarity = 'Error';
          }
        } else {
          similarity = 'Skipped';
        }
      } catch (err) {
        similarity = 'Error';
      }
      li.textContent = `Input: ${input} | Similarity: ${similarity}`;
    }
  });
}
