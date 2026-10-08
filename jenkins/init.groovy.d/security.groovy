import jenkins.model.Jenkins
import jenkins.model.JenkinsLocationConfiguration
import hudson.security.SecurityRealm
import hudson.security.AuthorizationStrategy

// Root URL is required for currentBuild.absoluteUrl / BUILD_URL to resolve.
def loc = JenkinsLocationConfiguration.get()
if (!loc.getUrl()) {
  loc.setUrl('http://localhost:8080/')
  loc.save()
}

// TEST ONLY: open the controller so a local pipeline can be triggered
// without a login. Never do this on a shared/real Jenkins.
def jenkins = Jenkins.get()
jenkins.setSecurityRealm(SecurityRealm.NO_AUTHENTICATION)
jenkins.setAuthorizationStrategy(AuthorizationStrategy.UNSECURED)
jenkins.setCrumbIssuer(null)
jenkins.save()
println('[asdlc] security disabled (anonymous, full access) - TEST ONLY')
