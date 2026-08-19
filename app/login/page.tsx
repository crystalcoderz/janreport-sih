import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhatsAppLoginForm } from "@/components/auth/whatsapp-login-form";
import { EmailMagicLinkForm } from "@/components/auth/email-magic-link-form";

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to JanReport</CardTitle>
          <CardDescription>
            Report civic issues and track their resolution. No password needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="email">
            <TabsList className="w-full">
              <TabsTrigger value="email" className="flex-1">
                Email
              </TabsTrigger>
              <TabsTrigger value="whatsapp" className="flex-1">
                WhatsApp
              </TabsTrigger>
            </TabsList>
            <TabsContent value="email" className="mt-4">
              <EmailMagicLinkForm />
            </TabsContent>
            <TabsContent value="whatsapp" className="mt-4">
              <WhatsAppLoginForm />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
