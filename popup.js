document.getElementById('authButton').addEventListener('click', authenticate);

async function authenticate() {
  console.log('Authenticating...');
  try {
    const auth = await chrome.identity.getAuthToken({ 
      interactive: true
    });
    
    console.log('Auth result:', auth);
    await listSpreadsheets(auth.token);
  } catch (error) {
    console.error('Authentication error:', error);
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
    const container = document.getElementById('spreadsheetList');
    container.innerHTML = `<p>Error: ${error.message}</p>`;
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
  const container = document.getElementById('spreadsheetList');
  container.innerHTML = '';

  if (!spreadsheets || spreadsheets.length === 0) {
    const noSheets = document.createElement('p');
    noSheets.textContent = 'No spreadsheets found.';
    container.appendChild(noSheets);
    return;
  }

  spreadsheets.forEach(sheet => {
    const div = document.createElement('div');
    div.className = 'spreadsheet-item';
    div.textContent = sheet.name;
    div.dataset.id = sheet.id;
    div.addEventListener('click', () => selectSpreadsheet(sheet));
    container.appendChild(div);
  });
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
