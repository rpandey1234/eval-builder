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

authButton.addEventListener('click', authenticate);
spreadsheetSelect.addEventListener('change', handleSpreadsheetChange);
approveButton.addEventListener('click', () => handleEvaluation(true));
rejectButton.addEventListener('click', () => handleEvaluation(false));
submitToClaude.addEventListener('click', handleClaudeSubmit);

let currentSpreadsheetId = null;
let anthropicApiKey = '';

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
  const authButton = document.getElementById('authButton');
  authButton.textContent = `Hi, ${userInfo.given_name || userInfo.name}`;
  authButton.disabled = true;
  authButton.classList.add('authenticated');
  
  // Show the spreadsheet selector
  document.getElementById('spreadsheetSelector').classList.add('visible');
}

function showUnauthenticatedState() {
  const authButton = document.getElementById('authButton');
  authButton.textContent = 'Sign in with Google';
  authButton.disabled = false;
  authButton.classList.remove('authenticated');
  
  // Hide the spreadsheet selector and eval form
  document.getElementById('spreadsheetSelector').classList.remove('visible');
  document.getElementById('evalForm').classList.remove('visible');
  
  // Reset the select
  const select = document.getElementById('spreadsheetSelect');
  select.innerHTML = '<option value="">Select a spreadsheet...</option>';
  
  // Reset the form
  promptInput.value = '';
  responseInput.value = '';
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
    showMessage('Enter prompt and response, then approve or reject.');
    
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
            // Display the full API key
            const apiKeyDisplay = document.getElementById('apiKeyDisplay');
            if (apiKeyDisplay) {
              apiKeyDisplay.textContent = anthropicApiKey ? anthropicApiKey : '(No API key found)';
            }
            console.log('Anthropic API key (full):', anthropicApiKey);
          } else {
            console.error('Failed to fetch API key from sheet.');
            const apiKeyDisplay = document.getElementById('apiKeyDisplay');
            if (apiKeyDisplay) {
              apiKeyDisplay.textContent = '(No API key found)';
            }
          }

          // Pre-populate prompt and input from the first data row
          console.log('Attempting to pre-populate fields from spreadsheet:', selectedValue);
          const sheetData = await readSpreadsheet(auth.token, selectedValue);
          console.log('Fetched sheet data:', sheetData);
          // Find the first sheet with data
          const sheet = sheetData.sheets && sheetData.sheets[0];
          if (sheet && sheet.data && sheet.data[0] && sheet.data[0].rowData && sheet.data[0].rowData.length > 1) {
            // rowData[0] is header, rowData[1] is first data row
            const firstRow = sheet.data[0].rowData[1];
            console.log('First data row:', firstRow);
            if (firstRow && firstRow.values) {
              // Prompt is col 1 (B), Input is col 2 (C)
              promptInput.value = firstRow.values[1]?.formattedValue || '';
              inputBox.value = firstRow.values[2]?.formattedValue || '';
              console.log('Pre-populated prompt:', promptInput.value);
              console.log('Pre-populated input:', inputBox.value);
            } else {
              console.log('No values found in first data row.');
            }
          } else {
            console.log('No data rows found in sheet.');
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
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-opus-20240229',
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
    claudeResponse.textContent = data.content[0].text;
    showMessage('Response received from Claude!');
  } catch (error) {
    console.error('Error calling Claude API:', error);
    showMessage(`Error: ${error.message}`, true);
    claudeResponse.textContent = 'Error getting response from Claude.';
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
    const auth = await chrome.identity.getAuthToken({ interactive: false });
    const values = [[
      new Date().toISOString(),
      promptInput.value,
      inputBox.value,
      claudeResponse.textContent,
      isApproved ? 'APPROVED' : 'REJECTED'
    ]];
    
    await appendToSpreadsheet(auth.token, currentSpreadsheetId, values);
    
    // Clear the form
    promptInput.value = '';
    inputBox.value = '';
    claudeResponse.textContent = '';
    showMessage(isApproved ? 'Evaluation approved and saved!' : 'Evaluation rejected and saved.');
  } catch (error) {
    console.error('Error saving evaluation:', error);
    showMessage(`Error saving evaluation: ${error.message}`, true);
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
      document.getElementById('evalForm').classList.add('visible');
      showMessage('Enter prompt and response, then approve or reject.');
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
