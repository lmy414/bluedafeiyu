import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrandLabel } from '../components/icons';
import { ErrorText, Field, fieldValue, readForm } from '../components/ui';
import { adminApi, loginReturnPath } from '../lib/api';
import { useMutation } from '../lib/hooks';

export function LoginPage({ theme }: { theme: ReactNode }) {
  const navigate = useNavigate();
  const login = useMutation();
  useEffect(() => { document.title = '登录 · 蓝色大肥鱼管理台'; }, []);

  return <main className="login-screen">
    <div className="login-theme">{theme}</div>
    <section className="login-panel panel">
      <div className="login-brand"><BrandLabel /></div>
      <h1>管理员登录</h1>
      <form className="login-form stack" onSubmit={event => {
        const form = readForm(event);
        const body = { email: fieldValue(form, 'email'), password: form.get('password') };
        void login.run(() => adminApi('/login', { method: 'POST', body }), () => navigate(loginReturnPath(), { replace: true }));
      }}>
        <Field label="管理员邮箱" name="email" type="email" autoComplete="username" required />
        <Field label="密码" name="password" type="password" autoComplete="current-password" required />
        <ErrorText message={login.error} />
        <button type="submit" className="primary" disabled={login.busy}>{login.busy ? '正在登录…' : '登录'}</button>
      </form>
    </section>
  </main>;
}
