-- ============================================================================
-- BidWork — 0002 Row-Level Security (run after 0001)
-- Tenant isolation: workspace-scoped rows are visible only to that workspace's
-- members; global operators (role='admin') see everything (needed for dispatch).
-- The service-role key bypasses RLS (used by Trigger.dev workers / server actions).
-- ============================================================================

-- ---------- helper functions (SECURITY DEFINER → read profiles w/o RLS) -----
create or replace function public.current_workspace_id()
returns uuid language sql stable security definer set search_path = public as $$
  select workspace_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

grant execute on function public.current_workspace_id() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- identity & global catalogs -------------------------------------
create policy workspaces_select on public.workspaces for select to authenticated
  using (id = public.current_workspace_id() or public.is_admin());
create policy workspaces_admin_all on public.workspaces for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or workspace_id = public.current_workspace_id() or public.is_admin());
create policy profiles_insert_own on public.profiles for insert to authenticated
  with check (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy trades_read on public.trades for select to authenticated using (true);
create policy trades_admin_write on public.trades for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy plans_read on public.plans for select to authenticated using (true);
create policy plans_admin_write on public.plans for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- workspace-scoped tables (member or admin) ----------------------
do $$
declare t text;
begin
  foreach t in array array['workspace_trades','pricing_items','bids','contacts','emails','subscriptions','bid_usage_events'] loop
    execute format($f$
      create policy %1$s_ws on public.%1$s for all to authenticated
        using (workspace_id = public.current_workspace_id() or public.is_admin())
        with check (workspace_id = public.current_workspace_id() or public.is_admin());
    $f$, t);
  end loop;
end $$;

-- children scoped via parent bid
create policy bid_line_items_ws on public.bid_line_items for all to authenticated
  using (exists (select 1 from public.bids b where b.id = bid_line_items.bid_id
                 and (b.workspace_id = public.current_workspace_id() or public.is_admin())))
  with check (exists (select 1 from public.bids b where b.id = bid_line_items.bid_id
                 and (b.workspace_id = public.current_workspace_id() or public.is_admin())));

create policy bid_edits_ws on public.bid_edits for all to authenticated
  using (exists (select 1 from public.bids b where b.id = bid_edits.bid_id
                 and (b.workspace_id = public.current_workspace_id() or public.is_admin())))
  with check (exists (select 1 from public.bids b where b.id = bid_edits.bid_id
                 and (b.workspace_id = public.current_workspace_id() or public.is_admin())));

-- ---------- operator-only tables (raw requests never reach contractors) -----
create policy bid_requests_admin on public.bid_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy documents_admin on public.documents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy extractions_admin on public.extractions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
