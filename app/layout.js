import "./globals.css";
import "./pwa.css";

export const metadata={
  title:"GEM Inspeções",
  description:"Gestão Estratégica de Manutenção",
  manifest:"/manifest.webmanifest",
  icons:{icon:"/gem-icon.svg",apple:"/gem-icon.svg"},
  appleWebApp:{capable:true,statusBarStyle:"default",title:"GEM Inspeções"}
};

export const viewport={
  width:"device-width",
  initialScale:1,
  viewportFit:"cover",
  themeColor:"#6a3028"
};

export default function RootLayout({children}){
  return <html lang="pt-BR"><body>{children}<script src="/pwa-client.js" defer></script></body></html>
}
