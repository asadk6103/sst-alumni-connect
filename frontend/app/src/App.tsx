import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { homeFor, useAuth } from '@/lib/auth';
import { FullPageSpinner, useSite } from '@/lib/site';
import { AdminLayout, ADMIN_NAV } from '@/layouts/AdminLayout';
import { PortalLayout } from '@/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/display';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, VerifyEmailPage } from '@/pages/auth/pages';
import { AccountPage } from '@/pages/portal/Account';

// Administration and setup screens load on demand (smaller first load for members).
const SetupWizard = lazy(() => import('@/pages/setup/SetupWizard').then((m) => ({ default: m.SetupWizard })));
const AdminDashboard = lazy(() => import('@/pages/admin/Dashboard').then((m) => ({ default: m.AdminDashboard })));
const UsersPage = lazy(() => import('@/pages/admin/Users').then((m) => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import('@/pages/admin/Roles').then((m) => ({ default: m.RolesPage })));
const ConfigurationPage = lazy(() => import('@/pages/admin/Configuration').then((m) => ({ default: m.ConfigurationPage })));
const ops = () => import('@/pages/admin/Operations');
const AuditPage = lazy(() => ops().then((m) => ({ default: m.AuditPage })));
const CommunicationsPage = lazy(() => ops().then((m) => ({ default: m.CommunicationsPage })));
const HealthPage = lazy(() => ops().then((m) => ({ default: m.HealthPage })));
const MediaPage = lazy(() => ops().then((m) => ({ default: m.MediaPage })));

function RequireAuth({ children, staff }: { children: ReactNode; staff?: boolean }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  // Mandatory 2FA / expired password: only the security page is reachable until resolved.
  if ((user.mfa_setup_required || user.password_expired) && loc.pathname !== '/portal/account/security') {
    return <Navigate to="/portal/account/security" replace />;
  }
  if (staff && !user.is_staff) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

function RequirePerm({ perms, children }: { perms: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!perms.some(can)) return <EmptyState icon={Compass} title="No access" description="You do not have permission to view this page." />;
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

const perm = (to: string) => ADMIN_NAV.find((n) => n.to === to)!.perms;

export function App() {
  const site = useSite();
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!site.installed && loc.pathname !== '/setup') return <Navigate to="/setup" replace />;
  return (
    <Routes>
      <Route path="/setup" element={<Suspense fallback={<FullPageSpinner />}><SetupWizard /></Suspense>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      <Route path="/admin" element={<RequireAuth staff><AdminLayout /></RequireAuth>}>
        <Route index element={<RequirePerm perms={perm('/admin')}><AdminDashboard /></RequirePerm>} />
        <Route path="users" element={<RequirePerm perms={perm('/admin/users')}><UsersPage /></RequirePerm>} />
        <Route path="roles" element={<RequirePerm perms={perm('/admin/roles')}><RolesPage /></RequirePerm>} />
        <Route path="media" element={<RequirePerm perms={perm('/admin/media')}><MediaPage /></RequirePerm>} />
        <Route path="communications" element={<RequirePerm perms={perm('/admin/communications')}><CommunicationsPage /></RequirePerm>} />
        <Route path="configuration/:section?" element={<RequirePerm perms={perm('/admin/configuration')}><ConfigurationPage /></RequirePerm>} />
        <Route path="audit" element={<RequirePerm perms={perm('/admin/audit')}><AuditPage /></RequirePerm>} />
        <Route path="health" element={<RequirePerm perms={perm('/admin/health')}><HealthPage /></RequirePerm>} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="/portal" element={<RequireAuth><PortalLayout /></RequireAuth>}>
        <Route index element={<Navigate to="/portal/account" replace />} />
        <Route path="account/:section?" element={<AccountPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="/" element={!ready ? <FullPageSpinner /> : <Navigate to={user ? homeFor(user) : '/login'} replace />} />
      <Route path="*" element={<div className="grid min-h-screen place-items-center bg-canvas"><NotFound /></div>} />
    </Routes>
  );
}

function PageLoading() {
  return <div className="grid h-64 place-items-center" role="status" aria-label="Loading"><span className="h-7 w-7 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary" /></div>;
}

function NotFound() {
  return <EmptyState icon={Compass} title="Page not found" description="The page you are looking for does not exist." action={<Button asChild variant="outline"><a href="/">Go home</a></Button>} />;
}
