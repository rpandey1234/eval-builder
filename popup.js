// Check auth state when popup opens
document.addEventListener('DOMContentLoaded', checkAuthState);
const authButton = document.getElementById('authButton');
const selectButton = document.getElementById('selectButton');
const spreadsheetSelect = document.getElementById('spreadsheetSelect');

authButton.addEventListener('click', authenticate);
selectButton.addEventListener('click', handleSpreadsheetSelection);
spreadsheetSelect.addEventListener('change', handleSpreadsheetChange);

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
  
  // Hide the spreadsheet selector
  document.getElementById('spreadsheetSelector').classList.remove('visible');
  
  // Reset the select
  const select = document.getElementById('spreadsheetSelect');
  select.innerHTML = '<option value="">Select a spreadsheet...</option>';
  document.getElementById('selectButton').disabled = true;
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
    displaySpreadsheets(data.files || []);
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
  const selectButton = document.getElementById('selectButton');
  selectButton.disabled = !event.target.value;
}

function handleSpreadsheetSelection() {
  const select = document.getElementById('spreadsheetSelect');
  const selectedOption = select.options[select.selectedIndex];
  
  if (selectedOption && selectedOption.value) {
    selectSpreadsheet({
      id: selectedOption.value,
      name: selectedOption.text
    });
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

// Helper function to write to spreadsheet using Sheets API
async function writeToSpreadsheet(token, spreadsheetId, range, values) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
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
    throw new Error(`Failed to write to spreadsheet: ${response.statusText}`);
  }
  
  return await response.json();
}

function displaySpreadsheets(spreadsheets) {
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
  
  showMessage('Please select a spreadsheet.');
}

function selectSpreadsheet(sheet) {
  chrome.storage.sync.set({ 
    selectedSpreadsheet: {
      id: sheet.id,
      name: sheet.name
    }
  }, () => {
    window.close();
  });
}
