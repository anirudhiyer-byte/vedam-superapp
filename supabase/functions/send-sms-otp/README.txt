VEDAM — Send SMS OTP hook (Supabase Edge Function -> MSG91)

Function secrets to set in Supabase (Project Settings -> Edge Functions -> Secrets,
or `supabase secrets set`):
  MSG91_AUTHKEY       = your MSG91 auth key
  MSG91_TEMPLATE_ID   = the ID copied from your MSG91 Templates list (copy icon)
  MSG91_OTP_VAR       = the variable name in your MSG91 template (e.g. otp)
  SEND_SMS_HOOK_SECRET= the secret Supabase shows when you enable the Send SMS Hook

Deploy:
  supabase functions deploy send-sms-otp --no-verify-jwt

Enable:
  Dashboard -> Authentication -> Hooks -> Send SMS Hook -> select this Edge Function.
