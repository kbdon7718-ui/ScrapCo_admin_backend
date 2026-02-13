const express = require('express');

const { createAnonClientWithJwt, createServiceClient } = require('../supabase/client');
const { getBearerToken } = require('../supabase/auth');

const router = express.Router();

function isAdminPortalAllowed() {
	const allowAdmin = String(process.env.ALLOW_ADMIN_PORTAL || '').toLowerCase() === 'true';
	const allowDev = String(process.env.ALLOW_DEV_BYPASS || '').toLowerCase() === 'true';
	return allowAdmin || allowDev;
}

function requireAdminEnabled(req, res) {
	if (isAdminPortalAllowed()) return true;
	res.status(403).json({
		success: false,
		error: 'Admin portal is disabled on server. Set ALLOW_ADMIN_PORTAL=true (or ALLOW_DEV_BYPASS=true) in admin_backend/.env.',
	});
	return false;
}

async function requireAdmin(req, res) {
	if (!requireAdminEnabled(req, res)) return null;

	const jwt = getBearerToken(req);
	if (!jwt) {
		res.status(401).json({ success: false, error: 'Missing Authorization: Bearer <token>' });
		return null;
	}

	let userId = null;
	try {
		const anon = createAnonClientWithJwt(jwt);
		const { data, error } = await anon.auth.getUser();
		if (error) {
			res.status(401).json({ success: false, error: 'Invalid or expired token' });
			return null;
		}
		userId = data?.user?.id || null;
	} catch (e) {
		res.status(500).json({ success: false, error: e?.message || 'Auth check failed' });
		return null;
	}

	if (!userId) {
		res.status(401).json({ success: false, error: 'Invalid or expired token' });
		return null;
	}

	try {
		const supabase = createServiceClient();
		const { data: profile, error } = await supabase
			.from('profiles')
			.select('role')
			.eq('id', userId)
			.maybeSingle();

		if (error) {
			res.status(400).json({ success: false, error: error.message });
			return null;
		}

		if (String(profile?.role || '').toLowerCase() !== 'admin') {
			res.status(403).json({ success: false, error: 'Admin access required' });
			return null;
		}

		return { userId };
	} catch (e) {
		res.status(500).json({ success: false, error: e?.message || 'Admin check failed' });
		return null;
	}
}

async function getActiveRateByType(supabase) {
	const { data, error } = await supabase
		.from('scrap_rates')
		.select('scrap_type_id,rate_per_kg,effective_from,is_active')
		.eq('is_active', true);

	if (error) throw error;

	const latest = new Map();
	for (const r of data || []) {
		const prev = latest.get(r.scrap_type_id);
		if (!prev) {
			latest.set(r.scrap_type_id, r);
			continue;
		}
		const prevDate = prev.effective_from ? new Date(prev.effective_from) : new Date(0);
		const nextDate = r.effective_from ? new Date(r.effective_from) : new Date(0);
		if (nextDate >= prevDate) latest.set(r.scrap_type_id, r);
	}
	return latest;
}

// GET /api/admin/me
router.get('/me', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;
	return res.json({ success: true, isAdmin: true, userId: admin.userId });
});

// GET /api/admin/vendors
router.get('/vendors', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	try {
		const supabase = createServiceClient();
		const { data, error } = await supabase.from('vendor_backends').select('*').limit(500);
		if (error) return res.status(400).json({ success: false, error: error.message });

		const rows = (data || []).map((v) => ({
			vendor_id: v.vendor_id ?? null,
			vendor_ref: v.vendor_ref ?? null,
			offer_url: v.offer_url ?? null,
			latitude: v.latitude ?? v.last_latitude ?? null,
			longitude: v.longitude ?? v.last_longitude ?? null,
			updated_at: v.updated_at ?? null,
		}));

		return res.json({ success: true, vendors: rows });
	} catch (e) {
		console.error('Admin vendors failed', e);
		return res.status(500).json({ success: false, error: e?.message || 'Admin request failed' });
	}
});

// GET /api/admin/scrap-types
router.get('/scrap-types', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	try {
		const supabase = createServiceClient();

		const { data: types, error: typesErr } = await supabase
			.from('scrap_types')
			.select('id,name')
			.order('name', { ascending: true });
		if (typesErr) return res.status(400).json({ success: false, error: typesErr.message });

		const rates = await getActiveRateByType(supabase);

		const rows = (types || []).map((t) => {
			const r = rates.get(t.id);
			return {
				id: t.id,
				name: t.name,
				ratePerKg: r?.rate_per_kg ?? null,
				effectiveFrom: r?.effective_from ?? null,
			};
		});

		return res.json({ success: true, scrapTypes: rows });
	} catch (e) {
		console.error('Admin scrap-types failed', e);
		return res.status(500).json({ success: false, error: e?.message || 'Admin request failed' });
	}
});

// POST /api/admin/scrap-types
router.post('/scrap-types', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	const name = String(req.body?.name || '').trim();
	if (!name) return res.status(400).json({ success: false, error: 'name is required' });

	try {
		const supabase = createServiceClient();
		const { data, error } = await supabase
			.from('scrap_types')
			.insert([{ name }])
			.select('id,name')
			.single();

		if (error) return res.status(400).json({ success: false, error: error.message });
		return res.status(201).json({ success: true, scrapType: data });
	} catch (e) {
		console.error('Admin create scrap-type failed', e);
		return res.status(500).json({ success: false, error: e?.message || 'Admin request failed' });
	}
});

// PATCH /api/admin/scrap-types/:id
router.patch('/scrap-types/:id', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	const id = String(req.params.id || '').trim();
	const name = String(req.body?.name || '').trim();
	if (!id) return res.status(400).json({ success: false, error: 'id is required' });
	if (!name) return res.status(400).json({ success: false, error: 'name is required' });

	try {
		const supabase = createServiceClient();
		const { data, error } = await supabase
			.from('scrap_types')
			.update({ name })
			.eq('id', id)
			.select('id,name')
			.maybeSingle();

		if (error) return res.status(400).json({ success: false, error: error.message });
		if (!data) return res.status(404).json({ success: false, error: 'scrap type not found' });

		return res.json({ success: true, scrapType: data });
	} catch (e) {
		console.error('Admin update scrap-type failed', e);
		return res.status(500).json({ success: false, error: e?.message || 'Admin request failed' });
	}
});

// POST /api/admin/scrap-rates
router.post('/scrap-rates', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	const scrapTypeId = String(req.body?.scrapTypeId || '').trim();
	const ratePerKg = Number(req.body?.ratePerKg);

	if (!scrapTypeId) return res.status(400).json({ success: false, error: 'scrapTypeId is required' });
	if (!Number.isFinite(ratePerKg) || ratePerKg <= 0) {
		return res.status(400).json({ success: false, error: 'ratePerKg must be a positive number' });
	}

	try {
		const supabase = createServiceClient();

		const { error: deactErr } = await supabase
			.from('scrap_rates')
			.update({ is_active: false })
			.eq('scrap_type_id', scrapTypeId)
			.eq('is_active', true);
		if (deactErr) return res.status(400).json({ success: false, error: deactErr.message });

		const row = {
			scrap_type_id: scrapTypeId,
			rate_per_kg: ratePerKg,
			is_active: true,
			effective_from: new Date().toISOString(),
		};

		const { data, error } = await supabase.from('scrap_rates').insert([row]).select('*').single();
		if (error) return res.status(400).json({ success: false, error: error.message });

		return res.status(201).json({
			success: true,
			rate: {
				scrapTypeId: data.scrap_type_id,
				ratePerKg: data.rate_per_kg,
				effectiveFrom: data.effective_from,
			},
		});
	} catch (e) {
		console.error('Admin set rate failed', e);
		return res.status(500).json({ success: false, error: e?.message || 'Admin request failed' });
	}
});

// GET /api/admin/site-stats
router.get('/site-stats', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	try {
		const supabase = createServiceClient();
		const { data, error } = await supabase
			.from('site_stats')
			.select('id,label,value,sort_order,is_active')
			.order('sort_order', { ascending: true, nullsFirst: false })
			.limit(500);
		if (error) return res.status(400).json({ success: false, error: error.message });

		const rows = (data || []).map((r) => ({
			id: r.id,
			label: r.label,
			value: r.value,
			sortOrder: r.sort_order ?? null,
			isActive: Boolean(r.is_active),
		}));

		return res.json({ success: true, stats: rows });
	} catch (e) {
		console.error('Admin site-stats failed', e);
		return res.status(500).json({ success: false, error: e?.message || 'Admin request failed' });
	}
});

// POST /api/admin/site-stats
router.post('/site-stats', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	const label = String(req.body?.label || '').trim();
	const value = String(req.body?.value || '').trim();
	const sortOrder = req.body?.sortOrder === undefined ? null : Number(req.body?.sortOrder);
	const isActive = req.body?.isActive === undefined ? true : Boolean(req.body?.isActive);

	if (!label) return res.status(400).json({ success: false, error: 'label is required' });
	if (!value) return res.status(400).json({ success: false, error: 'value is required' });
	if (sortOrder !== null && !Number.isFinite(sortOrder)) {
		return res.status(400).json({ success: false, error: 'sortOrder must be a number' });
	}

	try {
		const supabase = createServiceClient();
		const row = { label, value, sort_order: sortOrder, is_active: isActive };
		const { data, error } = await supabase
			.from('site_stats')
			.insert([row])
			.select('id,label,value,sort_order,is_active')
			.single();
		if (error) return res.status(400).json({ success: false, error: error.message });

		return res.status(201).json({
			success: true,
			stat: {
				id: data.id,
				label: data.label,
				value: data.value,
				sortOrder: data.sort_order ?? null,
				isActive: Boolean(data.is_active),
			},
		});
	} catch (e) {
		console.error('Admin create site-stat failed', e);
		return res.status(500).json({ success: false, error: e?.message || 'Admin request failed' });
	}
});

// PATCH /api/admin/site-stats/:id
router.patch('/site-stats/:id', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	const id = String(req.params.id || '').trim();
	if (!id) return res.status(400).json({ success: false, error: 'id is required' });

	const patch = {};
	if (req.body?.label !== undefined) patch.label = String(req.body.label || '').trim();
	if (req.body?.value !== undefined) patch.value = String(req.body.value || '').trim();
	if (req.body?.sortOrder !== undefined) {
		const sortOrder = req.body.sortOrder === null ? null : Number(req.body.sortOrder);
		if (sortOrder !== null && !Number.isFinite(sortOrder)) {
			return res.status(400).json({ success: false, error: 'sortOrder must be a number' });
		}
		patch.sort_order = sortOrder;
	}
	if (req.body?.isActive !== undefined) patch.is_active = Boolean(req.body.isActive);

	if (Object.keys(patch).length === 0) {
		return res.status(400).json({ success: false, error: 'No fields to update' });
	}

	try {
		const supabase = createServiceClient();
		const { data, error } = await supabase
			.from('site_stats')
			.update(patch)
			.eq('id', id)
			.select('id,label,value,sort_order,is_active')
			.maybeSingle();
		if (error) return res.status(400).json({ success: false, error: error.message });
		if (!data) return res.status(404).json({ success: false, error: 'stat not found' });

		return res.json({
			success: true,
			stat: {
				id: data.id,
				label: data.label,
				value: data.value,
				sortOrder: data.sort_order ?? null,
				isActive: Boolean(data.is_active),
			},
		});
	} catch (e) {
		console.error('Admin update site-stat failed', e);
		return res.status(500).json({ success: false, error: e?.message || 'Admin request failed' });
	}
});

// GET /api/admin/testimonials
router.get('/testimonials', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	try {
		const supabase = createServiceClient();
		const { data, error } = await supabase
			.from('testimonials')
			.select('id,name,quote,role,rating,sort_order,is_active')
			.order('sort_order', { ascending: true, nullsFirst: false })
			.limit(500);
		if (error) return res.status(400).json({ success: false, error: error.message });

		const rows = (data || []).map((r) => ({
			id: r.id,
			name: r.name,
			quote: r.quote,
			role: r.role ?? null,
			rating: r.rating ?? null,
			sortOrder: r.sort_order ?? null,
			isActive: Boolean(r.is_active),
		}));

		return res.json({ success: true, testimonials: rows });
	} catch (e) {
		console.error('Admin testimonials failed', e);
		return res.status(500).json({ success: false, error: e?.message || 'Admin request failed' });
	}
});

// POST /api/admin/testimonials
router.post('/testimonials', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	const name = String(req.body?.name || '').trim();
	const quote = String(req.body?.quote || '').trim();
	const role = req.body?.role === undefined ? null : String(req.body?.role || '').trim();
	const rating = req.body?.rating === undefined ? null : Number(req.body?.rating);
	const sortOrder = req.body?.sortOrder === undefined ? null : Number(req.body?.sortOrder);
	const isActive = req.body?.isActive === undefined ? true : Boolean(req.body?.isActive);

	if (!name) return res.status(400).json({ success: false, error: 'name is required' });
	if (!quote) return res.status(400).json({ success: false, error: 'quote is required' });
	if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) {
		return res.status(400).json({ success: false, error: 'rating must be between 1 and 5' });
	}
	if (sortOrder !== null && !Number.isFinite(sortOrder)) {
		return res.status(400).json({ success: false, error: 'sortOrder must be a number' });
	}

	try {
		const supabase = createServiceClient();
		const row = {
			name,
			quote,
			role: role || null,
			rating,
			sort_order: sortOrder,
			is_active: isActive,
		};

		const { data, error } = await supabase
			.from('testimonials')
			.insert([row])
			.select('id,name,quote,role,rating,sort_order,is_active')
			.single();
		if (error) return res.status(400).json({ success: false, error: error.message });

		return res.status(201).json({
			success: true,
			testimonial: {
				id: data.id,
				name: data.name,
				quote: data.quote,
				role: data.role ?? null,
				rating: data.rating ?? null,
				sortOrder: data.sort_order ?? null,
				isActive: Boolean(data.is_active),
			},
		});
	} catch (e) {
		console.error('Admin create testimonial failed', e);
		return res.status(500).json({ success: false, error: e?.message || 'Admin request failed' });
	}
});

// PATCH /api/admin/testimonials/:id
router.patch('/testimonials/:id', async (req, res) => {
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	const id = String(req.params.id || '').trim();
	if (!id) return res.status(400).json({ success: false, error: 'id is required' });

	const patch = {};
	if (req.body?.name !== undefined) patch.name = String(req.body.name || '').trim();
	if (req.body?.quote !== undefined) patch.quote = String(req.body.quote || '').trim();
	if (req.body?.role !== undefined) patch.role = req.body.role ? String(req.body.role).trim() : null;
	if (req.body?.rating !== undefined) {
		const rating = req.body.rating === null ? null : Number(req.body.rating);
		if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) {
			return res.status(400).json({ success: false, error: 'rating must be between 1 and 5' });
		}
		patch.rating = rating;
	}
	if (req.body?.sortOrder !== undefined) {
		const sortOrder = req.body.sortOrder === null ? null : Number(req.body.sortOrder);
		if (sortOrder !== null && !Number.isFinite(sortOrder)) {
			return res.status(400).json({ success: false, error: 'sortOrder must be a number' });
		}
		patch.sort_order = sortOrder;
	}
	if (req.body?.isActive !== undefined) patch.is_active = Boolean(req.body.isActive);

	if (Object.keys(patch).length === 0) {
		return res.status(400).json({ success: false, error: 'No fields to update' });
	}

	try {
		const supabase = createServiceClient();
		const { data, error } = await supabase
			.from('testimonials')
			.update(patch)
			.eq('id', id)
			.select('id,name,quote,role,rating,sort_order,is_active')
			.maybeSingle();
		if (error) return res.status(400).json({ success: false, error: error.message });
		if (!data) return res.status(404).json({ success: false, error: 'testimonial not found' });

		return res.json({
			success: true,
			testimonial: {
				id: data.id,
				name: data.name,
				quote: data.quote,
				role: data.role ?? null,
				rating: data.rating ?? null,
				sortOrder: data.sort_order ?? null,
				isActive: Boolean(data.is_active),
			},
		});
	} catch (e) {
		console.error('Admin update testimonial failed', e);
		return res.status(500).json({ success: false, error: e?.message || 'Admin request failed' });
	}
});

module.exports = router;
