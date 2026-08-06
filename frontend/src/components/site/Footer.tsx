import { Link } from 'react-router-dom';

type FooterLink = { label: string; to: string };

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border/60 bg-parchment/60">
      <div className="container-page grid gap-10 py-14 md:grid-cols-4">
        <div>
          <div className="font-display text-2xl">
            Bếp<span className="text-primary">.</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Hỏi một câu, chốt một bữa. Bếp bắt đầu từ cơn thèm của bạn rồi tìm món và quán hợp gu.
          </p>
        </div>
        {[
          {
            title: 'Chốt món',
            items: [
              { label: 'Tìm món và quán', to: '/search' },
              { label: 'Quán đang thơm', to: '/discover' },
              { label: 'Hỏi theo tâm trạng', to: '/' },
              { label: 'Mở bản đồ ăn', to: '/map' },
            ],
          },
          {
            title: 'Gu của bạn',
            items: [
              { label: 'Quán đã cất', to: '/saved' },
              { label: 'Gu ruột', to: '/profile' },
              { label: 'Vào Bếp', to: '/auth' },
            ],
          },
          {
            title: 'Bếp',
            items: [
              { label: 'Về bàn chính', to: '/' },
              { label: 'Dữ liệu quán thật', to: '/discover' },
              { label: 'Gõ cửa Bếp', to: 'mailto:hello@none.food' },
            ],
          },
        ].map((col) => (
          <div key={col.title}>
            <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {col.title}
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {col.items.map((item: FooterLink) => (
                <li key={item.label}>
                  {item.to.startsWith('mailto:') ? (
                    <a
                      href={item.to}
                      className="text-foreground/80 transition-colors hover:text-primary"
                    >
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      to={item.to}
                      className="text-foreground/80 transition-colors hover:text-primary"
                    >
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border/60">
        <div className="container-page flex flex-col items-start justify-between gap-2 py-5 text-xs text-muted-foreground md:flex-row md:items-center">
          <div>© {new Date().getFullYear()} Bếp - hỏi một câu, chốt một bữa.</div>
          <div className="flex gap-4">
            <span>Dữ liệu để tham khảo trước khi xách bụng đi ăn</span>
            <a href="mailto:hello@none.food" className="hover:text-foreground">
              Gõ cửa Bếp
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
