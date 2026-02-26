const { createClient } = require('@supabase/supabase-js');

function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function getAuthProjectEnv() {
  // Back-compat: old single-project env vars
  const url = process.env.ADMIN_AUTH_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.ADMIN_AUTH_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.ADMIN_AUTH_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, anonKey, serviceKey };
}

function getCustomerProjectEnv() {
  // If you have a separate customer DB project, set these.
  // Fallback to auth project so the backend still works in single-project setups.
  const auth = getAuthProjectEnv();
  return {
    url: process.env.CUSTOMER_SUPABASE_URL || auth.url,
    serviceKey: process.env.CUSTOMER_SUPABASE_SERVICE_ROLE_KEY || auth.serviceKey,
  };
}

function getVendorProjectEnv() {
  // If you have a separate vendor/godown DB project, set these.
  // Fallback to auth project so the backend still works in single-project setups.
  const auth = getAuthProjectEnv();
  return {
    url: process.env.VENDOR_SUPABASE_URL || auth.url,
    serviceKey: process.env.VENDOR_SUPABASE_SERVICE_ROLE_KEY || auth.serviceKey,
  };
}

function createServiceClient() {
  const url = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function createAuthServiceClient() {
  const { url, serviceKey } = getAuthProjectEnv();
  return createClient(requireEnvFromPair('ADMIN_AUTH_SUPABASE_URL', url), requireEnvFromPair('ADMIN_AUTH_SUPABASE_SERVICE_ROLE_KEY', serviceKey), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function createCustomerServiceClient() {
  const { url, serviceKey } = getCustomerProjectEnv();
  return createClient(requireEnvFromPair('CUSTOMER_SUPABASE_URL', url), requireEnvFromPair('CUSTOMER_SUPABASE_SERVICE_ROLE_KEY', serviceKey), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function createVendorServiceClient() {
  const { url, serviceKey } = getVendorProjectEnv();
  return createClient(requireEnvFromPair('VENDOR_SUPABASE_URL', url), requireEnvFromPair('VENDOR_SUPABASE_SERVICE_ROLE_KEY', serviceKey), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function createAnonClientWithJwt(jwt) {
  // JWT must be verified against the SAME Supabase project that issued it.
  // We treat ADMIN_AUTH_* as the issuer project for admin login.
  const { url, anonKey } = getAuthProjectEnv();
  const resolvedUrl = requireEnvFromPair('ADMIN_AUTH_SUPABASE_URL', url);
  const resolvedAnon = requireEnvFromPair('ADMIN_AUTH_SUPABASE_ANON_KEY', anonKey);

  return createClient(resolvedUrl, resolvedAnon, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function requireEnvFromPair(name, value) {
  // If an explicit env var is set, require it. Otherwise allow fallback value.
  if (process.env[name] != null && String(process.env[name]).trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

module.exports = {
  createServiceClient,
  createAnonClientWithJwt,
  createAuthServiceClient,
  createCustomerServiceClient,
  createVendorServiceClient,
};
