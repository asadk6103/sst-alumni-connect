import { useNavigate } from 'react-router-dom';
import { Bell, Newspaper, HandHeart, Images, LayoutDashboard, LogOut, Medal, Shield, UserCog, UserRound, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { Avatar } from '@/components/ui/display';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/overlay';

export function UserMenu({ light }: { light?: boolean }) {
  const { user, logout, can } = useAuth();
  const nav = useNavigate();
  const t = useT();
  if (!user) return null;
  return (
    <Menu>
      <MenuTrigger className={`flex items-center gap-2 rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 ${light ? 'focus-visible:ring-white/60' : 'focus-visible:ring-primary/40'}`}
        aria-label="Account menu">
        <Avatar name={user.full_name} size={38} className={light ? 'ring-2 ring-white/30' : ''} />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>
          <span className="block text-sm font-medium text-ink">{user.full_name}</span>
          <span className="block truncate">{user.email}</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem onSelect={() => nav('/portal/profile')}><UserRound />{t('menu.my_profile', 'My profile')}</MenuItem>
        {can('portal.directory') && <MenuItem onSelect={() => nav('/portal/connections')}><Users />{t('menu.my_network', 'My network')}</MenuItem>}
        <MenuItem onSelect={() => nav('/portal/achievements')}><Medal />{t('menu.achievements', 'Achievements')}</MenuItem>
        <MenuItem onSelect={() => nav('/portal/donations')}><HandHeart />{t('menu.giving', 'Donations & giving')}</MenuItem>
        <MenuItem onSelect={() => nav('/portal/news')}><Newspaper />{t('nav.news', 'News')}</MenuItem>
        <MenuItem onSelect={() => nav('/portal/gallery')}><Images />{t('menu.gallery', 'Gallery')}</MenuItem>
        <MenuItem onSelect={() => nav('/portal/notifications')}><Bell />{t('menu.notifications', 'Notifications')}</MenuItem>
        <MenuItem onSelect={() => nav('/portal/account')}><UserCog />{t('menu.account', 'Account settings')}</MenuItem>
        <MenuItem onSelect={() => nav('/portal/account/security')}><Shield />{t('menu.security', 'Security')}</MenuItem>
        {user.is_staff && <MenuItem onSelect={() => nav('/admin')}><LayoutDashboard />{t('menu.admin_panel', 'Admin panel')}</MenuItem>}
        <MenuSeparator />
        <MenuItem danger onSelect={async () => { await logout(); nav('/login'); }}><LogOut />{t('menu.sign_out', 'Sign out')}</MenuItem>
      </MenuContent>
    </Menu>
  );
}
