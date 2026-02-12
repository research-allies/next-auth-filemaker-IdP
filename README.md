# next-auth-filemaker-IdP
Authentication module for NextJS to use FileMaker Server as an identify provider.

## FileMaker Files
| Filename | description |
|---|---|
| IdP_Accounts.fmp12 | The main file for managing and retrieving FileMaker identities |
| IdP_File1.fmp12 | A sample solution file that receives distributed FileMaker accounts |

## Built-in accounts
Change these before deploying to production

| Account name | password | description |
|---|---|---|
| admin | admin | full access to the file |
| acct_dapi | acct_dapi | FM Data API access to validate the id |
| acct_odata | acct_odata | OData access to retreive account records and claims |
