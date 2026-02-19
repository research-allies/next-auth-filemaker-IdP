# next-auth-filemaker-IdP
Authentication module for NextJS to use FileMaker Server as an identify provider (IdP).

## FileMaker Files
| Filename | description |
|---|---|
| IdP_Accounts.fmp12 | The main file for managing and retrieving FileMaker identities |
| IdP_File1.fmp12 | A sample solution file that receives distributed FileMaker accounts |

## Built-in accounts
Change these before deploying to production

| Account name | password | description |
|---|---|---|
| admin | admin883 | full access to the demo FileMaker files |
| acct_dapi | acct_dapi | FM Data API access to validate the id |

## FileMaker user privilege sets
To manage internal FileMaker accounts across multiple FileMaker files follow the instructions in IdP_Accounts.fmp12. Note that all privilege sets assigned to users MUST have the FM_DAPI extended privilege set enabled in the IdP_Accounts.fmp12 file in order to use FM as the IdP.