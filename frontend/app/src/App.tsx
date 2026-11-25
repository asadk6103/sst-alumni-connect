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
import { PortalDashboard } from '@/pages/portal/Dashboard';

const RegisterPage = lazy(() => import('@/pages/auth/Register').then((m) => ({ default: m.RegisterPage })));
const DirectoryPage = lazy(() => import('@/pages/portal/Directory').then((m) => ({ default: m.DirectoryPage })));
const ProfileViewPage = lazy(() => import('@/pages/portal/Profile').then((m) => ({ default: m.ProfileViewPage })));
const MyProfilePage = lazy(() => import('@/pages/portal/MyProfile').then((m) => ({ default: m.MyProfilePage })));
const ConnectionsPage = lazy(() => import('@/pages/portal/Connections').then((m) => ({ default: m.ConnectionsPage })));
const community = () => import('@/pages/portal/Community');
const CommunityPage = lazy(() => community().then((m) => ({ default: m.CommunityPage })));
const GroupsPage = lazy(() => community().then((m) => ({ default: m.GroupsPage })));
const GroupPage = lazy(() => community().then((m) => ({ default: m.GroupPage })));
const PostPage = lazy(() => community().then((m) => ({ default: m.PostPage })));
const MessagesPage = lazy(() => import('@/pages/portal/Messages').then((m) => ({ default: m.MessagesPage })));
const evp = () => import('@/pages/portal/Events');
const EventsPage = lazy(() => evp().then((m) => ({ default: m.EventsPage })));
const EventPage = lazy(() => evp().then((m) => ({ default: m.EventPage })));
const jbp = () => import('@/pages/portal/Jobs');
const JobsPage = lazy(() => jbp().then((m) => ({ default: m.JobsPage })));
const JobPage = lazy(() => jbp().then((m) => ({ default: m.JobPage })));
const PostJobPage = lazy(() => jbp().then((m) => ({ default: m.PostJobPage })));
const JobApplicationsPage = lazy(() => jbp().then((m) => ({ default: m.JobApplicationsPage })));
const mnp = () => import('@/pages/portal/Mentorship');
const MentorshipPage = lazy(() => mnp().then((m) => ({ default: m.MentorshipPage })));
const MentorshipRequestPage = lazy(() => mnp().then((m) => ({ default: m.MentorshipRequestPage })));
const acp = () => import('@/pages/portal/Achievements');
const AchievementsPage = lazy(() => acp().then((m) => ({ default: m.AchievementsPage })));
const AchievementPage = lazy(() => acp().then((m) => ({ default: m.AchievementPage })));

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
const AlumniPage = lazy(() => import('@/pages/admin/Alumni').then((m) => ({ default: m.AlumniPage })));
const VerificationPage = lazy(() => import('@/pages/admin/Verification').then((m) => ({ default: m.VerificationPage })));
const BatchesPage = lazy(() => import('@/pages/admin/Batches').then((m) => ({ default: m.BatchesPage })));
const CommunityAdminPage = lazy(() => import('@/pages/admin/Community').then((m) => ({ default: m.CommunityAdminPage })));
const eng = () => import('@/pages/admin/Engagement');
const EventsAdminPage = lazy(() => eng().then((m) => ({ default: m.EventsAdminPage })));
const JobsAdminPage = lazy(() => eng().then((m) => ({ default: m.JobsAdminPage })));
const MentorshipAdminPage = lazy(() => eng().then((m) => ({ default: m.MentorshipAdminPage })));
const AchievementsAdminPage = lazy(() => eng().then((m) => ({ default: m.AchievementsAdminPage })));

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
      <Route path="/register" element={<Suspense fallback={<FullPageSpinner />}><RegisterPage /></Suspense>} />

      <Route path="/admin" element={<RequireAuth staff><AdminLayout /></RequireAuth>}>
        <Route index element={<RequirePerm perms={perm('/admin')}><AdminDashboard /></RequirePerm>} />
        <Route path="alumni/:tab?" element={<RequirePerm perms={perm('/admin/alumni')}><AlumniPage /></RequirePerm>} />
        <Route path="verification/:tab?" element={<RequirePerm perms={perm('/admin/verification')}><VerificationPage /></RequirePerm>} />
        <Route path="batches" element={<RequirePerm perms={perm('/admin/batches')}><BatchesPage /></RequirePerm>} />
        <Route path="community/:tab?" element={<RequirePerm perms={perm('/admin/community')}><CommunityAdminPage /></RequirePerm>} />
        <Route path="events/:id?" element={<RequirePerm perms={perm('/admin/events')}><EventsAdminPage /></RequirePerm>} />
        <Route path="jobs/:tab?" element={<RequirePerm perms={perm('/admin/jobs')}><JobsAdminPage /></RequirePerm>} />
        <Route path="mentorship" element={<RequirePerm perms={perm('/admin/mentorship')}><MentorshipAdminPage /></RequirePerm>} />
        <Route path="achievements" element={<RequirePerm perms={perm('/admin/achievements')}><AchievementsAdminPage /></RequirePerm>} />
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
        <Route index element={<PortalDashboard />} />
        <Route path="directory" element={<Lazy><DirectoryPage /></Lazy>} />
        <Route path="alumni/:id" element={<Lazy><ProfileViewPage /></Lazy>} />
        <Route path="profile/:tab?" element={<Lazy><MyProfilePage /></Lazy>} />
        <Route path="connections/:tab?" element={<Lazy><ConnectionsPage /></Lazy>} />
        <Route path="community" element={<Lazy><CommunityPage /></Lazy>} />
        <Route path="community/groups" element={<Lazy><GroupsPage /></Lazy>} />
        <Route path="community/groups/:id" element={<Lazy><GroupPage /></Lazy>} />
        <Route path="community/posts/:id" element={<Lazy><PostPage /></Lazy>} />
        <Route path="messages/:id?" element={<Lazy><MessagesPage /></Lazy>} />
        <Route path="events" element={<Lazy><EventsPage /></Lazy>} />
        <Route path="events/:id" element={<Lazy><EventPage /></Lazy>} />
        <Route path="jobs" element={<Lazy><JobsPage /></Lazy>} />
        <Route path="jobs/tab/:tab" element={<Lazy><JobsPage /></Lazy>} />
        <Route path="jobs/post/:id?" element={<Lazy><PostJobPage /></Lazy>} />
        <Route path="jobs/:id" element={<Lazy><JobPage /></Lazy>} />
        <Route path="jobs/:id/applications" element={<Lazy><JobApplicationsPage /></Lazy>} />
        <Route path="mentorship" element={<Lazy><MentorshipPage /></Lazy>} />
        <Route path="mentorship/tab/:tab" element={<Lazy><MentorshipPage /></Lazy>} />
        <Route path="mentorship/requests/:id" element={<Lazy><MentorshipRequestPage /></Lazy>} />
        <Route path="achievements" element={<Lazy><AchievementsPage /></Lazy>} />
        <Route path="achievements/:id" element={<Lazy><AchievementPage /></Lazy>} />
        <Route path="account/:section?" element={<AccountPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="/" element={!ready ? <FullPageSpinner /> : <Navigate to={user ? homeFor(user) : '/login'} replace />} />
      <Route path="*" element={<div className="grid min-h-screen place-items-center bg-canvas"><NotFound /></div>} />
    </Routes>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

function PageLoading() {
  return <div className="grid h-64 place-items-center" role="status" aria-label="Loading"><span className="h-7 w-7 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary" /></div>;
}

function NotFound() {
  return <EmptyState icon={Compass} title="Page not found" description="The page you are looking for does not exist." action={<Button asChild variant="outline"><a href="/">Go home</a></Button>} />;
}
